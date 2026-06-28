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
import { combineSkills } from "./pipeline/tag.ts";
import { inferSeniority } from "./pipeline/seniority.ts";
import { parseLocation } from "./pipeline/location.ts";
import { extractListing, type ExtractResult } from "./pipeline/extract.ts";
import { contentHash } from "./pipeline/hash.ts";
import { llmEnabled } from "./pipeline/llm.ts";
import { jobId, jobSlug } from "./util/id.ts";
import { mapPool } from "./util/concurrency.ts";

const SLEEP_MS = Number(process.env.INGEST_DELAY_MS ?? 400); // polite to feeds (Lever crawl-delay)
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 8); // parallel LLM calls per company
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    await mapPool(postings, CONCURRENCY, async (raw) => {
      if (!raw.applyUrl || !raw.title) return;
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

      // One LLM call does classification + skills + salary + location + seniority.
      // Skip it for titles the heuristic already rules OUT — they're discarded,
      // so there's nothing worth extracting (and it keeps the LLM bill down).
      let cls: ClassifyResult;
      let ex: ExtractResult | null = null;
      if (heuristicClass?.classification === "out") {
        cls = heuristicClass;
      } else if (llmEnabled()) {
        ex = await extractListing(raw.title, text, raw.locationRaw);
        cls =
          heuristicClass ??
          (ex
            ? {
                classification: ex.inScope ? "in" : "out",
                confidence: ex.confidence,
                via: "llm",
              }
            : { classification: "out", confidence: 0.3, via: "default" });
      } else {
        // No API key → heuristics only; exclude the ambiguous to stay credible.
        cls = heuristicClass ?? { classification: "out", confidence: 0.3, via: "default" };
      }

      const skills =
        cls.classification === "in" ? combineSkills(text, ex?.skills).skills : [];

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
        city: loc.city ?? ex?.city ?? undefined,
        remoteType: loc.remoteType ?? ex?.remoteType ?? undefined,
        seniority: inferSeniority(raw.title) ?? ex?.seniority ?? undefined,
        salaryMin: raw.salaryMin ?? ex?.salaryMin ?? undefined,
        salaryMax: raw.salaryMax ?? ex?.salaryMax ?? undefined,
        salaryCurrency: raw.salaryCurrency ?? ex?.salaryCurrency ?? undefined,
        salaryPeriod: raw.salaryPeriod ?? ex?.salaryPeriod ?? undefined,
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
    });
    console.log(`  ✓ ${t.name}: ${postings.length} postings, ${inThisCompany} in-scope`);
    await sleep(SLEEP_MS);
  }

  const closed = closeStaleJobs(db, runStart, polledSourceIds);
  db.close();
  console.log(
    `\nIngest complete. fetched=${fetched} processed=${processed} unchanged=${skipped} in-scope=${listed} closed=${closed} feeds_failed=${failed}`,
  );
}
