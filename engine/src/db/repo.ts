import type { DatabaseSync } from "node:sqlite";
import type { AtsProvider } from "@aiengjobs/shared";
import { companyId, sourceId, slugify } from "../util/id.ts";

export interface CompanyInput {
  name: string;
  slug: string;
  domain?: string;
  atsProvider: AtsProvider;
  atsToken: string;
  stage?: string;
}

export function upsertCompany(db: DatabaseSync, c: CompanyInput): string {
  const id = companyId(c.slug);
  db.prepare(
    `INSERT INTO companies (id, name, slug, domain, ats_provider, ats_token, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, domain=excluded.domain,
       ats_provider=excluded.ats_provider, ats_token=excluded.ats_token, stage=excluded.stage`,
  ).run(id, c.name, c.slug, c.domain ?? null, c.atsProvider, c.atsToken, c.stage ?? null);
  return id;
}

/** A source we deliberately do not poll, pending a fix. Distinct from 'retired',
 *  which is what happens to a source dropped from the seed file: retirement
 *  closes the jobs left behind, whereas pausing leaves them to age out on their
 *  own, because the board is expected back. */
export type SourceStatus = "active" | "paused";

export function upsertSource(
  db: DatabaseSync,
  cid: string,
  provider: AtsProvider,
  endpoint: string,
  status: SourceStatus = "active",
): string {
  const id = sourceId(cid, provider);
  // status is written on conflict too, so toggling the seed file's `paused`
  // flag takes effect on the next seed in BOTH directions — a source that is
  // paused today goes back to 'active' the moment the flag is removed.
  db.prepare(
    `INSERT INTO sources (id, company_id, ats_provider, endpoint_url, status)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET endpoint_url=excluded.endpoint_url, status=excluded.status`,
  ).run(id, cid, provider, endpoint, status);
  return id;
}

/**
 * Retire every active source not in `keepIds`, closing the jobs they left
 * behind. `closeStaleJobs` only ever touches sources that were polled this run,
 * so a board that stops being polled would otherwise strand its open jobs on
 * the site indefinitely — nothing else would ever close them.
 *
 * Returns the number of sources retired, or null if the retirement was refused
 * because `keepIds` covers less than `minFraction` of the active sources — the
 * signature of a truncated seed file rather than a deliberate removal.
 */
export function retireSourcesExcept(
  db: DatabaseSync,
  keepIds: string[],
  minFraction: number,
): number | null {
  // 'paused' counts as live here: a paused source is still listed in the seed
  // file and still expected back, so it belongs in the denominator, and — more
  // importantly — it has to remain retirable. Dooming only 'active' rows would
  // strand a paused source (and its open jobs) forever the moment its row was
  // deleted from the file, which is the exact leak retirement exists to close.
  const { live } = db
    .prepare(`SELECT COUNT(*) AS live FROM sources WHERE status IN ('active','paused')`)
    .get() as unknown as { live: number };
  if (live > 0 && keepIds.length < live * minFraction) return null;

  const placeholders = keepIds.map(() => "?").join(",") || "NULL";
  const doomed = db
    .prepare(
      `SELECT id FROM sources WHERE status IN ('active','paused') AND id NOT IN (${placeholders})`,
    )
    .all(...keepIds) as unknown as { id: string }[];
  if (doomed.length === 0) return 0;

  const ids = doomed.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  db.prepare(`UPDATE sources SET status = 'retired' WHERE id IN (${marks})`).run(...ids);
  db.prepare(
    `UPDATE jobs SET is_closed = 1
     WHERE is_direct = 0 AND is_closed = 0 AND source_id IN (${marks})`,
  ).run(...ids);
  return ids.length;
}

export interface PollTarget {
  companyId: string;
  name: string;
  slug: string;
  domain?: string;
  atsProvider: AtsProvider;
  atsToken: string;
  sourceId: string;
}

export function listPollTargets(db: DatabaseSync): PollTarget[] {
  const rows = db
    .prepare(
      `SELECT c.id AS cid, c.name, c.slug, c.domain, c.ats_provider, c.ats_token, s.id AS sid
       FROM companies c JOIN sources s ON s.company_id = c.id
       WHERE s.status = 'active'`,
    )
    .all() as unknown as {
    cid: string;
    name: string;
    slug: string;
    domain: string | null;
    ats_provider: string;
    ats_token: string | null;
    sid: string;
  }[];
  return rows.map((r) => ({
    companyId: r.cid,
    name: r.name,
    slug: r.slug,
    domain: r.domain ?? undefined,
    atsProvider: r.ats_provider as AtsProvider,
    atsToken: r.ats_token ?? r.slug,
    sourceId: r.sid,
  }));
}

export function getExistingJob(
  db: DatabaseSync,
  id: string,
): { contentHash: string | null; isClosed: number } | undefined {
  const r = db
    .prepare(`SELECT content_hash, is_closed FROM jobs WHERE id = ?`)
    .get(id) as { content_hash: string | null; is_closed: number } | undefined;
  return r ? { contentHash: r.content_hash, isClosed: r.is_closed } : undefined;
}

export interface JobUpsert {
  id: string;
  companyId: string;
  sourceId: string;
  externalId: string;
  slug: string;
  title: string;
  normalizedTitle: string;
  descriptionHtml?: string;
  descriptionText?: string;
  applyUrl: string;
  locationRaw?: string;
  country?: string;
  region?: string;
  city?: string;
  remoteType?: string;
  seniority?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
  classification: string;
  classificationConfidence?: number;
  isDirect?: number;
  postedAt?: string;
  updatedAt?: string;
  ingestedAt: string;
  contentHash: string;
  dedupKey: string;
  lastSeenAt: string;
}

const N = (v: string | number | undefined): string | number | null => v ?? null;

export function upsertJob(db: DatabaseSync, j: JobUpsert): void {
  db.prepare(
    `INSERT INTO jobs (
       id, company_id, source_id, external_id, slug, title, normalized_title,
       description_html, description_text, apply_url, location_raw, country, region, city,
       remote_type, seniority, salary_min, salary_max, salary_currency, salary_period,
       classification, classification_confidence, is_direct, posted_at, updated_at,
       ingested_at, content_hash, dedup_key, last_seen_at, is_new, is_closed
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, normalized_title=excluded.normalized_title,
       description_html=excluded.description_html, description_text=excluded.description_text,
       apply_url=excluded.apply_url, location_raw=excluded.location_raw,
       country=excluded.country, region=excluded.region, city=excluded.city,
       remote_type=excluded.remote_type, seniority=excluded.seniority,
       salary_min=excluded.salary_min, salary_max=excluded.salary_max,
       salary_currency=excluded.salary_currency, salary_period=excluded.salary_period,
       classification=excluded.classification, classification_confidence=excluded.classification_confidence,
       updated_at=excluded.updated_at, content_hash=excluded.content_hash,
       dedup_key=excluded.dedup_key, last_seen_at=excluded.last_seen_at, is_closed=0`,
  ).run(
    j.id,
    j.companyId,
    j.sourceId,
    j.externalId,
    j.slug,
    j.title,
    j.normalizedTitle,
    N(j.descriptionHtml),
    N(j.descriptionText),
    j.applyUrl,
    N(j.locationRaw),
    N(j.country),
    N(j.region),
    N(j.city),
    N(j.remoteType),
    N(j.seniority),
    N(j.salaryMin),
    N(j.salaryMax),
    N(j.salaryCurrency),
    N(j.salaryPeriod),
    j.classification,
    N(j.classificationConfidence),
    j.isDirect ?? 0,
    N(j.postedAt),
    N(j.updatedAt),
    j.ingestedAt,
    j.contentHash,
    j.dedupKey,
    j.lastSeenAt,
  );
}

export function setJobSkills(
  db: DatabaseSync,
  jobId: string,
  skillNames: string[],
): void {
  db.prepare(`DELETE FROM job_skills WHERE job_id = ?`).run(jobId);
  if (skillNames.length === 0) return;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO job_skills (job_id, skill_id) VALUES (?, ?)`,
  );
  for (const name of skillNames) ins.run(jobId, `sk_${slugify(name)}`);
}

export function markSeen(db: DatabaseSync, jobId: string, ts: string): void {
  db.prepare(`UPDATE jobs SET last_seen_at = ?, is_closed = 0 WHERE id = ?`).run(
    ts,
    jobId,
  );
}

/**
 * Mark non-direct jobs not seen in this run as closed — the "no ghost jobs"
 * promise (§6.5) — and report how many went per source.
 *
 * The breakdown is what makes the number actionable: 800 closures spread over
 * the whole board is a normal night, whereas 800 from one source is a feed that
 * changed shape and quietly emptied a company off the site.
 */
export function closeStaleJobs(
  db: DatabaseSync,
  runStart: string,
  polledSourceIds: string[],
): Map<string, number> {
  const bySource = new Map<string, number>();
  if (polledSourceIds.length === 0) return bySource;
  const placeholders = polledSourceIds.map(() => "?").join(",");
  // RETURNING gives the affected rows from the same statement that closes them,
  // so the breakdown cannot drift from what was actually written.
  const rows = db
    .prepare(
      `UPDATE jobs SET is_closed = 1
       WHERE is_direct = 0 AND is_closed = 0
         AND source_id IN (${placeholders})
         AND (last_seen_at IS NULL OR last_seen_at < ?)
       RETURNING source_id`,
    )
    .all(...polledSourceIds, runStart) as { source_id: string }[];
  for (const r of rows) {
    bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1);
  }
  return bySource;
}

/** How long a closed role stays in the database.
 *
 *  Three times the snapshot's CLOSED_RETENTION_DAYS, so a tombstone always
 *  outlives its page by a wide margin and this can never be what removes one. */
const PRUNE_AFTER_DAYS = 90;

/** Delete long-closed roles and reclaim their pages.
 *
 *  Nothing used to remove rows: the table grew ~890/day, each carrying the full
 *  description twice (HTML + text). The database had reached 61k rows / 122 MiB
 *  gzipped, and every run downloads, gunzips, re-gzips and re-uploads that as a
 *  release asset — plus a second copy in actions/cache against a 10 GB budget.
 *  Left alone that is ~325k rows and roughly half a gigabyte within a year, all
 *  of it roles that closed months ago and are in no snapshot.
 *
 *  VACUUM is what actually returns the space; without it SQLite keeps the freed
 *  pages for reuse and the file never shrinks. */
export function pruneClosedJobs(
  db: DatabaseSync,
  afterDays = PRUNE_AFTER_DAYS,
): number {
  const cutoff = new Date(Date.now() - afterDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `DELETE FROM jobs
       WHERE is_closed = 1
         AND last_seen_at IS NOT NULL
         AND last_seen_at < ?
       RETURNING id`,
    )
    .all(cutoff) as { id: string }[];
  if (rows.length > 0) db.exec("VACUUM");
  return rows.length;
}
