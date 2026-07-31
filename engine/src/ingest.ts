import { openDb } from "./db/index.ts";
import {
  listPollTargets,
  getExistingJob,
  upsertJob,
  setJobSkills,
  markSeen,
  closeStaleJobs,
} from "./db/repo.ts";
import { getConnector } from "./connectors/index.ts";
import { normalize } from "./pipeline/normalize.ts";
import { classifyHeuristic, type ClassifyResult } from "./pipeline/classify.ts";
import { tagHeuristic } from "./pipeline/tag.ts";
import { inferSeniority } from "./pipeline/seniority.ts";
import { parseLocation } from "./pipeline/location.ts";
import { parseSalaryFromDescription } from "./pipeline/comp.ts";
import { contentHash } from "./pipeline/hash.ts";
import { encoderAvailable, encoderScore } from "./pipeline/encoder.ts";
import { ENCODER_THRESHOLD, ENCODER_VETO_CONFIDENCE } from "./config.ts";
import { jobId, jobSlug } from "./util/id.ts";
import { mapPool } from "./util/concurrency.ts";

const SLEEP_MS = Number(process.env.INGEST_DELAY_MS ?? 400); // polite to feeds (Lever crawl-delay)
// Classification is now local and CPU-bound rather than a network round-trip, so
// this bounds cores in use, not in-flight requests. One session per posting at
// one thread each; oversubscribing just thrashes.
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Apply links come from third-party feeds and end up as hrefs on the site —
// only plain web URLs are acceptable (a javascript: link would be an XSS).
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

// Connectors use undefined for "absent"; the description parser uses null.
interface PayFields {
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
}

/**
 * Pay fields, but only when the currency is known. Each source is taken as a
 * unit rather than field-by-field, so a range can't be paired with a currency
 * parsed from a different source.
 */
function pay(
  raw: PayFields,
  fromDescription?: PayFields | null,
): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
} {
  for (const src of [raw, fromDescription]) {
    if (!src) continue;
    const min = src.salaryMin;
    const max = src.salaryMax;
    if ((min || max) && src.salaryCurrency) {
      return {
        salaryMin: min ?? undefined,
        salaryMax: max ?? undefined,
        salaryCurrency: src.salaryCurrency,
        salaryPeriod: src.salaryPeriod ?? undefined,
      };
    }
  }
  return {};
}

/** Poll every seeded source, classify/tag, upsert, then expire vanished jobs (§6.4–6.5). */
export async function ingest(): Promise<void> {
  const db = openDb();
  const targets = listPollTargets(db);
  if (targets.length === 0) {
    console.log("No companies seeded. Run `npm run seed -w @aiengjobs/engine` first.");
    db.close();
    return;
  }
  console.log(
    `Ingest: ${targets.length} sources. Classifier ${encoderAvailable() ? "encoder (local ONNX)" : "unavailable — heuristics only"}.`,
  );

  const runStart = new Date().toISOString();
  const polledSourceIds: string[] = [];
  let fetched = 0;
  let processed = 0;
  let skipped = 0;
  let listed = 0;
  let failed = 0;
  let errored = 0;

  for (const t of targets) {
    const connector = getConnector(t.atsProvider);
    if (!connector) continue;

    let postings;
    try {
      postings = await connector.fetchPostings(t.atsToken);
    } catch (e) {
      failed++;
      console.warn(`  ! ${t.name} (${t.atsProvider}:${t.atsToken}): ${(e as Error).message}`);
      await sleep(SLEEP_MS);
      continue;
    }
    polledSourceIds.push(t.sourceId);
    fetched += postings.length;

    let inThisCompany = 0;
    // Each posting is isolated: one bad payload logs and skips rather than
    // killing the run (which would also skip closeStaleJobs and leave the
    // board full of ghost jobs).
    await mapPool(postings, CONCURRENCY, async (raw) => {
      try {
        if (!raw.applyUrl || !raw.title || !isHttpUrl(raw.applyUrl)) return;
        const id = jobId(t.slug, raw.externalId);
        const hash = contentHash([
          raw.title,
          raw.descriptionText ?? raw.descriptionHtml,
          raw.locationRaw,
          raw.salaryMin,
          raw.salaryMax,
        ]);

        const existing = getExistingJob(db, id);
        if (existing && existing.contentHash === hash && existing.isClosed === 0) {
          markSeen(db, id, runStart); // unchanged → skip reprocessing (skips inference)
          skipped++;
          return;
        }

        const norm = normalize(raw, t.slug);
        const text = norm.descriptionText ?? "";
        const loc = parseLocation(raw.locationRaw, raw.remoteType, raw.remoteHint);
        const heuristicClass = classifyHeuristic(raw.title);

        // Local encoder decides scope. Skip it for titles the heuristic already
        // rules OUT — those are discarded regardless, and skipping is a third of
        // the nightly volume.
        let cls: ClassifyResult;
        if (heuristicClass?.classification === "out") {
          cls = heuristicClass;
        } else if (encoderAvailable()) {
          const p = await encoderScore(id, raw.title, t.name, raw.locationRaw ?? "", text);
          if (p === null) {
            // Inference failed for this posting; fall back rather than guess.
            cls = heuristicClass ?? { classification: "out", confidence: 0.3, via: "default" };
          } else if (heuristicClass?.classification === "in") {
            // Title looks IN. The model read the description, so let it veto an
            // over-broad title match (e.g. "Support Agent" caught by /agent/)
            // when it is confidently OUT; otherwise keep the heuristic prior.
            cls =
              1 - p >= ENCODER_VETO_CONFIDENCE
                ? { classification: "out", confidence: 1 - p, via: "model" }
                : heuristicClass;
          } else {
            // Ambiguous title → the model decides outright at the calibrated
            // operating point. Confidence is reported as distance from the
            // decision, so a 0.99 IN and a 0.01 OUT are both high-confidence.
            const isIn = p >= ENCODER_THRESHOLD;
            cls = { classification: isIn ? "in" : "out", confidence: isIn ? p : 1 - p, via: "model" };
          }
        } else {
          // No model files → heuristics only; exclude the ambiguous to stay credible.
          cls = heuristicClass ?? { classification: "out", confidence: 0.3, via: "default" };
        }

        const skills =
          cls.classification === "in" ? tagHeuristic(text).skills : [];

        // Everything below the classification comes from the feed payload and
        // the heuristics derived from it. The LLM used to backfill country,
        // city, remoteType and seniority where the payload was silent; the
        // encoder classifies only, so those gaps now stay empty. Measured on
        // 3,703 live IN jobs, that costs 3.8% of country, 5.3% of city and
        // 26.2% of seniority values. remoteType is unaffected — parseLocation
        // always returns one when locationRaw is non-empty, which is always.
        upsertJob(db, {
          id,
          companyId: t.companyId,
          sourceId: t.sourceId,
          externalId: raw.externalId,
          slug: jobSlug(t.slug, raw.title, raw.externalId),
          title: raw.title,
          normalizedTitle: norm.normalizedTitle,
          descriptionHtml: raw.descriptionHtml,
          descriptionText: norm.descriptionText,
          applyUrl: raw.applyUrl,
          locationRaw: raw.locationRaw,
          country: loc.country ?? undefined,
          city: loc.city ?? undefined,
          remoteType: loc.remoteType ?? undefined,
          seniority: inferSeniority(raw.title) ?? undefined,
          // An unlabelled number isn't a salary: the site would render it as
          // USD, and feeds that omit the currency are usually the non-USD ones
          // (a Graphcore posting shipped a bare 260400-352200, which is PLN —
          // ~$70k shown as $260k). Drop the pay rather than guess at it.
          // …and when the feed is silent, fall back to the description itself.
          // US pay-transparency law puts an explicit range in the body of a lot
          // of Workday/Greenhouse posts, and missing it renders "Not published"
          // on a page that visibly publishes one.
          ...pay(raw, parseSalaryFromDescription(text)),
          classification: cls.classification,
          classificationConfidence: cls.confidence,
          isDirect: 0,
          postedAt: raw.postedAt,
          updatedAt: raw.updatedAt,
          ingestedAt: runStart,
          contentHash: hash,
          dedupKey: norm.dedupKey,
          lastSeenAt: runStart,
        });
        setJobSkills(db, id, skills);
        processed++;
        if (cls.classification === "in") {
          listed++;
          inThisCompany++;
        }
      } catch (e) {
        errored++;
        console.warn(
          `  ! ${t.name}: posting "${raw.title ?? raw.externalId}" failed: ${(e as Error).message}`,
        );
      }
    });
    console.log(`  ✓ ${t.name}: ${postings.length} postings, ${inThisCompany} in-scope`);
    await sleep(SLEEP_MS);
  }

  const closed = closeStaleJobs(db, runStart, polledSourceIds);
  db.close();
  console.log(
    `\nIngest complete. fetched=${fetched} processed=${processed} unchanged=${skipped} in-scope=${listed} closed=${closed} feeds_failed=${failed} postings_errored=${errored}`,
  );
}
