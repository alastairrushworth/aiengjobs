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
import { extractListing, type ExtractResult } from "./pipeline/extract.ts";
import { contentHash } from "./pipeline/hash.ts";
import { llmEnabled } from "./pipeline/llm.ts";
import { LLM_IN_CONFIDENCE_FLOOR, LLM_VETO_CONFIDENCE } from "./config.ts";
import { canonicalCity } from "@aiengjobs/shared/city";
import { jobId, jobSlug } from "./util/id.ts";
import { mapPool } from "./util/concurrency.ts";

const SLEEP_MS = Number(process.env.INGEST_DELAY_MS ?? 400); // polite to feeds (Lever crawl-delay)
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 8); // parallel LLM calls per company
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Apply links come from third-party feeds and end up as hrefs on the site —
// only plain web URLs are acceptable (a javascript: link would be an XSS).
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

// Connectors use undefined for "absent"; the LLM extractor uses null.
interface PayFields {
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
}

/**
 * Pay fields, but only when the currency is known. Feed pay and LLM-extracted
 * pay are taken as a unit rather than field-by-field, so a range can't be
 * paired with a currency parsed from a different source.
 */
function pay(
  raw: PayFields,
  ex?: PayFields | null,
): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
} {
  for (const src of [raw, ex]) {
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
    `Ingest: ${targets.length} sources. LLM ${llmEnabled() ? "enabled (GPT-5.4-nano)" : "disabled — heuristics only"}.`,
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
          markSeen(db, id, runStart); // unchanged → skip reprocessing (saves LLM cost)
          skipped++;
          return;
        }

        const norm = normalize(raw, t.slug);
        const text = norm.descriptionText ?? "";
        const loc = parseLocation(raw.locationRaw, raw.remoteType, raw.remoteHint);
        const heuristicClass = classifyHeuristic(raw.title);

        // One LLM call does classification + salary + location + seniority.
        // Skip it for titles the heuristic already rules OUT — they're discarded,
        // so there's nothing worth extracting (and it keeps the LLM bill down).
        let cls: ClassifyResult;
        let ex: ExtractResult | null = null;
        if (heuristicClass?.classification === "out") {
          cls = heuristicClass;
        } else if (llmEnabled()) {
          ex = await extractListing(raw.title, text, raw.locationRaw);
          if (heuristicClass?.classification === "in") {
            // Title looks IN. The LLM read the full description, so let it veto an
            // over-broad title match (e.g. "Support Agent" caught by /agent/) when
            // it's confidently OUT; otherwise keep the heuristic prior.
            cls =
              ex && ex.inScope === false && ex.confidence >= LLM_VETO_CONFIDENCE
                ? { classification: "out", confidence: ex.confidence, via: "llm" }
                : heuristicClass;
          } else {
            // Ambiguous title → the LLM decides outright, but an IN must clear
            // the confidence floor: below it the posting is excluded to keep
            // the board credible (spec: no borderline listings).
            cls = ex
              ? {
                  classification:
                    ex.inScope && ex.confidence >= LLM_IN_CONFIDENCE_FLOOR
                      ? "in"
                      : "out",
                  confidence: ex.confidence,
                  via: "llm",
                }
              : { classification: "out", confidence: 0.3, via: "default" };
          }
        } else {
          // No API key → heuristics only; exclude the ambiguous to stay credible.
          cls = heuristicClass ?? { classification: "out", confidence: 0.3, via: "default" };
        }

        const skills =
          cls.classification === "in" ? tagHeuristic(text).skills : [];

        // Prefer the ATS/role payload (and the heuristics derived from it); fall
        // back to the LLM extraction only where the payload is silent.
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
          country: loc.country ?? ex?.country ?? undefined,
          // The LLM's city has to go through the same gate as the parsed one —
          // it happily returns "null", "Headquarters" or "Bay Area", and this
          // field is published as addressLocality in the JobPosting markup.
          city: loc.city ?? canonicalCity(ex?.city) ?? undefined,
          remoteType: loc.remoteType ?? ex?.remoteType ?? undefined,
          seniority: inferSeniority(raw.title) ?? ex?.seniority ?? undefined,
          // An unlabelled number isn't a salary: the site would render it as
          // USD, and feeds that omit the currency are usually the non-USD ones
          // (a Graphcore posting shipped a bare 260400-352200, which is PLN —
          // ~$70k shown as $260k). Drop the pay rather than guess at it.
          ...pay(raw, ex),
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
