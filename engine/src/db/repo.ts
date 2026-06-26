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

export function upsertSource(
  db: DatabaseSync,
  cid: string,
  provider: AtsProvider,
  endpoint: string,
): string {
  const id = sourceId(cid, provider);
  db.prepare(
    `INSERT INTO sources (id, company_id, ats_provider, endpoint_url, status)
     VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT(id) DO UPDATE SET endpoint_url=excluded.endpoint_url, status='active'`,
  ).run(id, cid, provider, endpoint);
  return id;
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

/** Mark non-direct jobs not seen in this run as closed — the "no ghost jobs" promise (§6.5). */
export function closeStaleJobs(
  db: DatabaseSync,
  runStart: string,
  polledSourceIds: string[],
): number {
  if (polledSourceIds.length === 0) return 0;
  const placeholders = polledSourceIds.map(() => "?").join(",");
  const res = db
    .prepare(
      `UPDATE jobs SET is_closed = 1
       WHERE is_direct = 0 AND is_closed = 0
         AND source_id IN (${placeholders})
         AND (last_seen_at IS NULL OR last_seen_at < ?)`,
    )
    .run(...polledSourceIds, runStart);
  return Number(res.changes);
}
