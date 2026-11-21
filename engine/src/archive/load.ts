import { createReadStream, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import { ARCHIVE_SCHEMA } from "./export.ts";

/**
 * Turn a directory of archive files into one SQLite database to query.
 *
 *   aws s3 sync s3://frontierroles-archive/runs ./archive --endpoint-url …
 *   npm run archive:load -w @aiengjobs/engine -- ./archive history.db
 *
 * The archive is a log of changes; analysis wants tables. This builds them:
 *
 *   runs              one row per nightly run: when, which code, which classifier
 *   source_runs       every source on every run, and whether it was read in full
 *   posting_versions  every distinct state a posting has been in, with the run
 *                     it was first seen in that state (`as_of`)
 *   posting_text      the advert text, once per distinct advert
 *   posting_spans     the periods each posting was open — more than one if it
 *                     closed and came back
 *   postings          (view) the latest version of each posting
 *
 * "What was open on 1 March 2027" is then
 *
 *   SELECT v.* FROM posting_spans s JOIN posting_versions v ON v.id = s.id
 *   WHERE s.seen_from <= '2027-03-01' AND (s.seen_to IS NULL OR s.seen_to >= '2027-03-01')
 *     AND v.as_of = (SELECT MAX(as_of) FROM posting_versions
 *                    WHERE id = s.id AND as_of <= '2027-03-01T23:59:59Z')
 *
 * and "was this employer's board being read that week" is a query on
 * source_runs. Rebuilt from scratch each time: the files are the record, this
 * database is disposable.
 */
const SCHEMA_SQL = `
  CREATE TABLE runs (
    run_at TEXT PRIMARY KEY, file TEXT NOT NULL, schema INTEGER NOT NULL,
    engine_sha TEXT, classifier TEXT, postings INTEGER, complete INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE source_runs (
    run_at TEXT NOT NULL, source_id TEXT NOT NULL, company_id TEXT, company_slug TEXT,
    company_name TEXT, provider TEXT, status TEXT NOT NULL, fetched INTEGER, error TEXT,
    PRIMARY KEY (run_at, source_id)
  );
  CREATE TABLE posting_versions (
    id TEXT NOT NULL, as_of TEXT NOT NULL, row_hash TEXT NOT NULL,
    source_id TEXT, external_id TEXT, company_id TEXT, company_slug TEXT, company_name TEXT,
    provider TEXT, slug TEXT, title TEXT, normalized_title TEXT, apply_url TEXT,
    location_raw TEXT, country TEXT, region TEXT, city TEXT, remote_type TEXT, seniority TEXT,
    salary_min REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT,
    classification TEXT, classification_confidence REAL, model_score REAL,
    is_direct INTEGER, is_closed INTEGER, posted_at TEXT, updated_at TEXT,
    first_seen_at TEXT, last_seen_at TEXT, delisted_at TEXT, content_hash TEXT, skills TEXT,
    PRIMARY KEY (id, as_of)
  );
  CREATE INDEX idx_versions_company ON posting_versions(company_slug);
  CREATE TABLE posting_text (
    id TEXT NOT NULL, content_hash TEXT NOT NULL, text TEXT NOT NULL,
    PRIMARY KEY (id, content_hash)
  );
  CREATE TABLE posting_spans (
    id TEXT NOT NULL, seq INTEGER NOT NULL, seen_from TEXT NOT NULL, seen_to TEXT,
    PRIMARY KEY (id, seq)
  );
  CREATE INDEX idx_spans_dates ON posting_spans(seen_from, seen_to);
  CREATE VIEW postings AS
    SELECT v.* FROM posting_versions v
    WHERE v.as_of = (SELECT MAX(as_of) FROM posting_versions WHERE id = v.id);
`;

interface Line {
  kind: string;
  [key: string]: unknown;
}

/**
 * One parsed line at a time, split on "\n" and nothing else. Not readline:
 * it also breaks on U+2028 and U+2029, which are legal inside a JSON string.
 * The writer escapes both, but a reader that depends on the writer having been
 * careful is how one bad file makes a whole archive unreadable.
 */
async function* lines(path: string): AsyncGenerator<Line> {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  for await (const chunk of createReadStream(path).pipe(createGunzip())) {
    const parts = (rest + decoder.write(chunk as Buffer)).split("\n");
    rest = parts.pop()!;
    for (const part of parts) if (part) yield JSON.parse(part) as Line;
  }
  rest += decoder.end();
  // No trailing newline means the stream stopped mid-line: a truncated file.
  // Its complete lines above are still good; the fragment is not.
}

export interface LoadResult {
  runs: number;
  versions: number;
  postings: number;
  /** Files with no closing line: an upload that was cut short. Loaded, but flagged. */
  incomplete: string[];
}

export async function loadArchive(dir: string, outPath: string): Promise<LoadResult> {
  if (outPath !== ":memory:" && statSync(outPath, { throwIfNoEntry: false })) {
    throw new Error(`${outPath} already exists — the history database is rebuilt from scratch; remove it first`);
  }
  const db = new DatabaseSync(outPath);
  db.exec(SCHEMA_SQL);
  const result = await loadInto(db, dir);
  db.close();
  return result;
}

/** As loadArchive, into a database the caller holds (and keeps open). */
export async function loadInto(db: DatabaseSync, dir: string): Promise<LoadResult> {
  const hasSchema = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'runs'").get();
  if (!hasSchema) db.exec(SCHEMA_SQL);

  // Run order is file-name order: names are the run's timestamp.
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".jsonl.gz"))
    .sort((a, b) => a.split("/").pop()!.localeCompare(b.split("/").pop()!));

  const insertRun = db.prepare(
    "INSERT OR REPLACE INTO runs (run_at, file, schema, engine_sha, classifier) VALUES (?, ?, ?, ?, ?)",
  );
  const endRun = db.prepare("UPDATE runs SET postings = ?, complete = 1 WHERE run_at = ?");
  const insertSource = db.prepare(
    `INSERT OR REPLACE INTO source_runs
     (run_at, source_id, company_id, company_slug, company_name, provider, status, fetched, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertVersion = db.prepare(
    `INSERT OR REPLACE INTO posting_versions VALUES
     (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertText = db.prepare("INSERT OR REPLACE INTO posting_text (id, content_hash, text) VALUES (?, ?, ?)");

  // The last state loaded for each posting. A file whose upload succeeded but
  // whose commit did not is written again the next night, so the same version
  // can arrive twice; it is the same version, and is kept once.
  const lastHash = new Map<string, string>();
  const incomplete: string[] = [];
  let versions = 0;
  const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const flag = (v: unknown): number => (v ? 1 : 0);

  for (const file of files) {
    let runAt = "";
    let ended = false;
    db.exec("BEGIN");
    for await (const l of lines(join(dir, file))) {
      if (l.kind === "run") {
        if (Number(l.schema) > ARCHIVE_SCHEMA) {
          db.exec("ROLLBACK");
          throw new Error(`${file} is archive schema ${String(l.schema)}; this loader reads up to ${ARCHIVE_SCHEMA}`);
        }
        runAt = String(l.runAt);
        insertRun.run(runAt, file, Number(l.schema), str(l.engineSha), str(l.classifier));
      } else if (l.kind === "source") {
        insertSource.run(
          runAt, String(l.sourceId), str(l.companyId), str(l.companySlug), str(l.companyName),
          str(l.provider), String(l.status), num(l.fetched), str(l.error),
        );
      } else if (l.kind === "posting") {
        const id = String(l.id);
        if (typeof l.text === "string") {
          insertText.run(id, str(l.contentHash) ?? String(l.rowHash), l.text);
        }
        if (lastHash.get(id) === l.rowHash) continue;
        lastHash.set(id, String(l.rowHash));
        insertVersion.run(
          id, runAt, String(l.rowHash), str(l.sourceId), str(l.externalId), str(l.companyId),
          str(l.companySlug), str(l.companyName), str(l.provider), str(l.slug), str(l.title),
          str(l.normalizedTitle), str(l.applyUrl), str(l.locationRaw), str(l.country), str(l.region),
          str(l.city), str(l.remoteType), str(l.seniority), num(l.salaryMin), num(l.salaryMax),
          str(l.salaryCurrency), str(l.salaryPeriod), str(l.classification),
          num(l.classificationConfidence), num(l.modelScore), flag(l.isDirect), flag(l.isClosed),
          str(l.postedAt), str(l.updatedAt), str(l.firstSeenAt), str(l.lastSeenAt), str(l.delistedAt),
          str(l.contentHash), JSON.stringify(l.skills ?? []),
        );
        versions++;
      } else if (l.kind === "end") {
        endRun.run(Number(l.postings), runAt);
        ended = true;
      }
    }
    db.exec("COMMIT");
    if (!ended) incomplete.push(file);
  }

  // Spans: walk each posting's versions in order. It is open from when it was
  // first seen (or, coming back from closed, from the run that saw it again)
  // until the last day it was seen before closing.
  db.exec("DELETE FROM posting_spans");
  const insertSpan = db.prepare("INSERT INTO posting_spans (id, seq, seen_from, seen_to) VALUES (?, ?, ?, ?)");
  const ordered = db
    .prepare(
      "SELECT id, as_of, is_closed, first_seen_at, last_seen_at FROM posting_versions ORDER BY id, as_of",
    )
    .iterate() as Iterable<{
    id: string;
    as_of: string;
    is_closed: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
  }>;
  let current = "";
  let seq = 0;
  let openFrom: string | null = null;
  let everOpened = false;
  let postings = 0;
  db.exec("BEGIN");
  const close = (id: string, to: string | null) => {
    if (openFrom === null) return;
    insertSpan.run(id, seq++, openFrom, to);
    openFrom = null;
  };
  for (const v of ordered) {
    if (v.id !== current) {
      close(current, null);
      current = v.id;
      seq = 0;
      openFrom = null;
      everOpened = false;
      postings++;
    }
    if (!v.is_closed) {
      if (openFrom === null) openFrom = everOpened ? v.as_of : (v.first_seen_at ?? v.as_of);
      everOpened = true;
    } else {
      // First seen already closed (the baseline holds roles that closed before
      // the archive began): it was open from first sight to last.
      if (openFrom === null && !everOpened) openFrom = v.first_seen_at ?? v.as_of;
      everOpened = true;
      close(v.id, v.last_seen_at ?? v.as_of);
    }
  }
  close(current, null);
  db.exec("COMMIT");

  return { runs: files.length, versions, postings, incomplete };
}
