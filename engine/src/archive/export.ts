import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createGzip } from "node:zlib";

/**
 * The permanent record of every posting the engine has ever seen.
 *
 * The working database is built to stay small: closed roles are deleted 90
 * days after they close and out-of-scope adverts lose their text the night
 * they arrive. Both are right for a file that is downloaded and re-uploaded
 * every night, and both destroy exactly what a question like "how did hiring
 * change over two years" needs. This module writes what would be lost to an
 * archive first.
 *
 * It is a change log, not a set of snapshots. Each run appends one file that
 * is never rewritten:
 *
 *   {"kind":"run", ...}       what ran: when, which code, which classifier
 *   {"kind":"source", ...}    every source, and whether it was read in full tonight
 *   {"kind":"posting", ...}   every posting that is new or has changed
 *   {"kind":"end", ...}       a count, which proves the file is complete
 *
 * Three properties make the result usable for longitudinal work, and each is
 * the answer to a way such data usually goes wrong:
 *
 * 1. Versions, not final states. A posting that is retitled, repriced,
 *    reclassified, closed or reopened gets a new line each time, so what the
 *    board showed on any past night can be rebuilt as it was, not as the row
 *    happened to end up.
 *
 * 2. Coverage is recorded beside the data. "No postings from this employer in
 *    March" means nothing unless you know its feed was being read in March.
 *    Every run lists every source with its outcome, so absence can be told
 *    from a broken connector, a paused feed or a run that ran out of time.
 *
 * 3. The advert text is kept for every posting, in scope or not. Scope is a
 *    judgement that changes — the rubric has been rewritten three times — and
 *    comparing 2027 with 2026 under one definition means re-scoring 2026's
 *    postings with 2027's classifier. That is only possible with the text.
 *
 * Writing is two-phase so that a failed upload can never lose anything. The
 * export marks what it wrote as *pending*; `commitArchive` promotes it once the
 * file is safely stored. An export whose file never arrived is simply written
 * again the next night, and until a posting's text and closure are committed
 * the database will not drop the one or delete the other (see `onlyArchived`
 * on dropOutOfScopeText and pruneClosedJobs). The failure mode is a duplicate
 * line, which the loader folds; it is never a gap.
 */

/** Bumped when a line's meaning changes. The loader reads every version it knows. */
export const ARCHIVE_SCHEMA = 1;

export type SourceStatus =
  /** Listed its whole board. Roles missing from it tonight really are gone. */
  | "polled"
  /** Truncated listing: what it returned is real, what it omitted is unknown. */
  | "partial"
  /** Returned nothing — indistinguishable from a renamed board or an expired token. */
  | "empty"
  /** Threw. Nothing about this employer was learned tonight. */
  | "failed"
  /** Not reached before the run's time budget ran out. */
  | "skipped"
  /** No connector for its ATS. */
  | "unsupported"
  /** Deliberately not polled (companies.csv). */
  | "paused";

export interface SourceResult {
  sourceId: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  provider: string;
  status: SourceStatus;
  /** Postings the feed returned in full tonight. */
  fetched: number;
  error?: string;
}

export interface ArchiveRun {
  /** When the ingest run began — the "as of" for every line in the file. */
  runAt: string;
  /** Git commit of the engine, when known. */
  engineSha?: string;
  /** Identity of the classifier weights in use (ml/model/manifest.json digest). */
  classifier?: string;
  sources: SourceResult[];
}

export interface ArchiveResult {
  file: string;
  path: string;
  postings: number;
  withText: number;
}

/**
 * What has been archived for each posting, and what is waiting on an upload.
 * Lives in the working database so that it travels with it between runs.
 */
export function ensureArchiveState(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS archive_state (
      job_id            TEXT PRIMARY KEY,
      row_hash          TEXT,
      text_hash         TEXT,
      closed            INTEGER NOT NULL DEFAULT 0,
      pending_row_hash  TEXT,
      pending_text_hash TEXT,
      pending_closed    INTEGER,
      pending_file      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_archive_pending ON archive_state(pending_file);
  `);
}

interface JobRow {
  id: string;
  source_id: string | null;
  external_id: string | null;
  company_id: string;
  company_slug: string;
  company_name: string;
  provider: string;
  slug: string;
  title: string;
  normalized_title: string;
  apply_url: string;
  location_raw: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  remote_type: string | null;
  seniority: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  classification: string;
  classification_confidence: number | null;
  model_score: number | null;
  is_direct: number;
  is_closed: number;
  posted_at: string | null;
  updated_at: string | null;
  ingested_at: string;
  last_seen_at: string | null;
  delisted_at: string | null;
  content_hash: string | null;
  description_text: string | null;
  skills: string | null;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** One posting as the archive records it. `text` is added separately. */
function record(r: JobRow) {
  return {
    kind: "posting" as const,
    id: r.id,
    sourceId: r.source_id,
    externalId: r.external_id,
    companyId: r.company_id,
    companySlug: r.company_slug,
    companyName: r.company_name,
    provider: r.provider,
    slug: r.slug,
    title: r.title,
    normalizedTitle: r.normalized_title,
    applyUrl: r.apply_url,
    locationRaw: r.location_raw,
    country: r.country,
    region: r.region,
    city: r.city,
    remoteType: r.remote_type,
    seniority: r.seniority,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    salaryCurrency: r.salary_currency,
    salaryPeriod: r.salary_period,
    classification: r.classification,
    classificationConfidence: r.classification_confidence,
    modelScore: r.model_score,
    isDirect: r.is_direct === 1,
    isClosed: r.is_closed === 1,
    postedAt: r.posted_at,
    updatedAt: r.updated_at,
    firstSeenAt: r.ingested_at,
    lastSeenAt: r.last_seen_at,
    delistedAt: r.delisted_at,
    contentHash: r.content_hash,
    skills: r.skills ? r.skills.split("\u001f").sort() : [],
  };
}

/**
 * The identity of a version. Everything in the record except `lastSeenAt` on an
 * open role: that moves every night for every live posting, and "still there"
 * is already what the absence of a new line says. Once a role closes the date
 * is the closure date, which is a fact worth a version.
 */
function rowHash(rec: ReturnType<typeof record>): string {
  return sha(JSON.stringify({ ...rec, lastSeenAt: rec.isClosed ? rec.lastSeenAt : null }));
}

const fileNameFor = (runAt: string): string => `${runAt.replace(/[:.]/g, "-")}.jsonl.gz`;

/** Where a run's file lives in the bucket: runs/2026/11/<runAt>.jsonl.gz. */
export const archiveKeyFor = (file: string): string => `runs/${file.slice(0, 4)}/${file.slice(5, 7)}/${file}`;

/**
 * Write this run's file and mark what it contains as pending.
 *
 * Call it after closures have been decided and before anything is pruned or
 * emptied. The first run against a database writes every row — that file is
 * the archive's baseline.
 */
export async function exportArchive(
  db: DatabaseSync,
  run: ArchiveRun,
  outDir: string,
): Promise<ArchiveResult> {
  ensureArchiveState(db);
  mkdirSync(outDir, { recursive: true });
  const file = fileNameFor(run.runAt);
  const path = join(outDir, file);

  const committed = new Map<string, { row_hash: string | null; text_hash: string | null }>();
  for (const s of db.prepare("SELECT job_id, row_hash, text_hash FROM archive_state").iterate() as Iterable<{
    job_id: string;
    row_hash: string | null;
    text_hash: string | null;
  }>) {
    committed.set(s.job_id, s);
  }

  const gzip = createGzip();
  const sink = createWriteStream(path);
  gzip.pipe(sink);
  // One JSON value per "\n"-terminated line, and "\n" is the only line break
  // in the file: JSON.stringify leaves U+2028 and U+2029 raw, adverts do
  // contain them, and plenty of line readers (Node's own readline among them)
  // split on both.
  const write = async (line: unknown): Promise<void> => {
    const json = JSON.stringify(line).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    if (!gzip.write(json + "\n")) await once(gzip, "drain");
  };

  await write({
    kind: "run",
    schema: ARCHIVE_SCHEMA,
    runAt: run.runAt,
    engineSha: run.engineSha ?? null,
    classifier: run.classifier ?? null,
  });
  for (const s of run.sources) await write({ kind: "source", ...s });

  const pending: [string, string, string | null, number][] = [];
  let withText = 0;
  const jobs = db
    .prepare(
      `SELECT j.id, j.source_id, j.external_id, j.company_id, c.slug AS company_slug,
              c.name AS company_name, c.ats_provider AS provider, j.slug, j.title,
              j.normalized_title, j.apply_url, j.location_raw, j.country, j.region, j.city,
              j.remote_type, j.seniority, j.salary_min, j.salary_max, j.salary_currency,
              j.salary_period, j.classification, j.classification_confidence, j.model_score,
              j.is_direct, j.is_closed, j.posted_at, j.updated_at, j.ingested_at,
              j.last_seen_at, j.delisted_at, j.content_hash, j.description_text,
              (SELECT group_concat(s.name, char(31)) FROM job_skills js
                 JOIN skills s ON s.id = js.skill_id WHERE js.job_id = j.id) AS skills
       FROM jobs j JOIN companies c ON c.id = j.company_id`,
    )
    .iterate() as Iterable<JobRow>;
  for (const r of jobs) {
    const rec = record(r);
    const hash = rowHash(rec);
    const was = committed.get(r.id);
    // The text travels once per distinct advert: a closure or a reclassification
    // is a few hundred bytes, not the whole description again.
    const textHash = r.description_text === null ? null : (r.content_hash ?? sha(r.description_text));
    const sendText = textHash !== null && textHash !== was?.text_hash;
    if (was?.row_hash === hash && !sendText) continue;
    await write({ ...rec, rowHash: hash, ...(sendText ? { text: r.description_text } : {}) });
    pending.push([r.id, hash, sendText ? textHash : null, r.is_closed]);
    if (sendText) withText++;
  }

  await write({ kind: "end", postings: pending.length, withText });
  gzip.end();
  await once(sink, "finish");

  // One transaction: yesterday's pending marks, if its upload never committed,
  // are replaced by tonight's — those rows have just been written again.
  db.exec("BEGIN");
  try {
    db.exec(
      "UPDATE archive_state SET pending_row_hash = NULL, pending_text_hash = NULL, pending_closed = NULL, pending_file = NULL WHERE pending_file IS NOT NULL",
    );
    const mark = db.prepare(
      `INSERT INTO archive_state (job_id, pending_row_hash, pending_text_hash, pending_closed, pending_file)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         pending_row_hash = excluded.pending_row_hash,
         pending_text_hash = excluded.pending_text_hash,
         pending_closed = excluded.pending_closed,
         pending_file = excluded.pending_file`,
    );
    for (const [id, hash, textHash, closed] of pending) mark.run(id, hash, textHash, closed, file);
    // Rows the prune has since deleted have nothing left to track.
    db.exec("DELETE FROM archive_state WHERE job_id NOT IN (SELECT id FROM jobs)");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { file, path, postings: pending.length, withText };
}

/**
 * Promote a file's pending marks once it is safely stored. Returns how many
 * postings it covered; zero means the file was already committed or was
 * superseded by a later export, both of which are fine.
 */
export function commitArchive(db: DatabaseSync, file: string): number {
  ensureArchiveState(db);
  const rows = db
    .prepare(
      `UPDATE archive_state SET
         row_hash = pending_row_hash,
         text_hash = COALESCE(pending_text_hash, text_hash),
         closed = pending_closed,
         pending_row_hash = NULL, pending_text_hash = NULL, pending_closed = NULL, pending_file = NULL
       WHERE pending_file = ?
       RETURNING job_id`,
    )
    .all(file) as { job_id: string }[];
  return rows.length;
}

/** Postings whose latest state is written but not yet confirmed stored. */
export function archiveBacklog(db: DatabaseSync): number {
  ensureArchiveState(db);
  return (db.prepare("SELECT COUNT(*) AS n FROM archive_state WHERE pending_file IS NOT NULL").get() as { n: number }).n;
}
