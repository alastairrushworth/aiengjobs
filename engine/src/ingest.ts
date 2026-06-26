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
import { classifyJob } from "./pipeline/classify.ts";
import { tagJob } from "./pipeline/tag.ts";
import { inferSeniority } from "./pipeline/seniority.ts";
import { parseLocation } from "./pipeline/location.ts";
import { contentHash } from "./pipeline/hash.ts";
import { llmEnabled } from "./pipeline/llm.ts";
import { jobId, jobSlug } from "./util/id.ts";

const SLEEP_MS = Number(process.env.INGEST_DELAY_MS ?? 400); // polite to feeds (Lever crawl-delay)
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
    for (const raw of postings) {
      if (!raw.applyUrl || !raw.title) continue;
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
        continue;
      }

      const norm = normalize(raw, t.slug);
      const cls = await classifyJob(raw.title, raw.descriptionText ?? "");
      const tags =
        cls.classification === "in"
          ? await tagJob(`${raw.title}\n${raw.descriptionText ?? ""}`)
          : { skills: [], clusters: [] };
      const loc = parseLocation(raw.locationRaw, raw.remoteType, raw.remoteHint);

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
        country: loc.country,
        city: loc.city,
        remoteType: loc.remoteType,
        seniority: inferSeniority(raw.title),
        salaryMin: raw.salaryMin,
        salaryMax: raw.salaryMax,
        salaryCurrency: raw.salaryCurrency,
        salaryPeriod: raw.salaryPeriod,
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
      setJobSkills(db, id, tags.skills);
      processed++;
      if (cls.classification === "in") {
        listed++;
        inThisCompany++;
      }
    }
    console.log(`  ✓ ${t.name}: ${postings.length} postings, ${inThisCompany} in-scope`);
    await sleep(SLEEP_MS);
  }

  const closed = closeStaleJobs(db, runStart, polledSourceIds);
  db.close();
  console.log(
    `\nIngest complete. fetched=${fetched} processed=${processed} unchanged=${skipped} in-scope=${listed} closed=${closed} feeds_failed=${failed}`,
  );
}
