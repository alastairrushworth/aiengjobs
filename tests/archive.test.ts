import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import {
  archiveBacklog,
  archiveKeyFor,
  commitArchive,
  ensureArchiveState,
  exportArchive,
  type SourceResult,
} from "../engine/src/archive/export.ts";
import { loadInto } from "../engine/src/archive/load.ts";
import { dropOutOfScopeText, pruneClosedJobs } from "../engine/src/db/repo.ts";

const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  ensureArchiveState(db);
  db.prepare("INSERT INTO companies (id, name, slug, ats_provider) VALUES ('co_a', 'Acme', 'acme', 'greenhouse')").run();
  db.prepare("INSERT INTO sources (id, company_id, ats_provider, endpoint_url) VALUES ('src_a', 'co_a', 'greenhouse', 'https://x')").run();
  return db;
}

interface JobOpts {
  title?: string;
  classification?: "in" | "out";
  text?: string | null;
  hash?: string;
  isClosed?: number;
  lastSeen?: string;
  ingested?: string;
}
function addJob(db: DatabaseSync, id: string, o: JobOpts = {}): void {
  db.prepare(
    `INSERT INTO jobs (id, company_id, source_id, slug, title, normalized_title, apply_url,
                       classification, description_text, description_html, content_hash,
                       is_closed, last_seen_at, ingested_at)
     VALUES (?, 'co_a', 'src_a', ?, ?, ?, 'https://x/apply', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    id,
    o.title ?? "AI Engineer",
    (o.title ?? "AI Engineer").toLowerCase(),
    o.classification ?? "in",
    o.text === undefined ? "Build agents." : o.text,
    o.text === null ? null : "<p>html</p>",
    o.hash ?? `hash-${id}`,
    o.isClosed ?? 0,
    o.lastSeen ?? "2026-11-21T23:00:00.000Z",
    o.ingested ?? "2026-11-01T23:00:00.000Z",
  );
}

const SOURCES: SourceResult[] = [
  { sourceId: "src_a", companyId: "co_a", companySlug: "acme", companyName: "Acme", provider: "greenhouse", status: "polled", fetched: 2 },
];
const run = (runAt: string) => ({ runAt, engineSha: "abc123", classifier: "onnx:test@0.7", sources: SOURCES });
const read = (path: string): Record<string, unknown>[] =>
  gunzipSync(readFileSync(path)).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
const dir = () => mkdtempSync(join(tmpdir(), "archive-"));

describe("exportArchive", () => {
  it("writes a baseline of every posting on its first run, framed by the run and its sources", async () => {
    const db = makeDb();
    addJob(db, "j1");
    addJob(db, "j2", { classification: "out", text: "Reconcile ledgers." });
    const result = await exportArchive(db, run("2026-11-21T23:10:00.000Z"), dir());
    const lines = read(result.path);

    expect(result).toMatchObject({ file: "2026-11-21T23-10-00-000Z.jsonl.gz", postings: 2, withText: 2 });
    expect(lines[0]).toMatchObject({ kind: "run", schema: 1, runAt: "2026-11-21T23:10:00.000Z", engineSha: "abc123", classifier: "onnx:test@0.7" });
    expect(lines[1]).toMatchObject({ kind: "source", sourceId: "src_a", status: "polled", fetched: 2 });
    expect(lines.at(-1)).toEqual({ kind: "end", postings: 2, withText: 2 });
    // Out-of-scope adverts keep their text: scope is re-decidable only with it.
    expect(lines.find((l) => l.id === "j2")).toMatchObject({ classification: "out", text: "Reconcile ledgers.", companySlug: "acme" });
  });

  it("files under the year and month of the run", () => {
    expect(archiveKeyFor("2026-11-21T23-10-00-000Z.jsonl.gz")).toBe("runs/2026/11/2026-11-21T23-10-00-000Z.jsonl.gz");
  });

  it("writes nothing for a posting that has not changed — being seen again is not a change", async () => {
    const db = makeDb();
    addJob(db, "j1");
    const out = dir();
    commitArchive(db, (await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out)).file);
    db.prepare("UPDATE jobs SET last_seen_at = '2026-11-22T23:00:00.000Z'").run();
    const next = await exportArchive(db, run("2026-11-22T23:10:00.000Z"), out);
    expect(next.postings).toBe(0);
    // The run and its sources are still recorded: coverage is logged every night.
    expect(read(next.path).map((l) => l.kind)).toEqual(["run", "source", "end"]);
  });

  it("writes a new version when a posting changes, without repeating the advert", async () => {
    const db = makeDb();
    addJob(db, "j1");
    const out = dir();
    commitArchive(db, (await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out)).file);

    db.prepare("UPDATE jobs SET classification = 'out' WHERE id = 'j1'").run();
    const reclassified = await exportArchive(db, run("2026-11-22T23:10:00.000Z"), out);
    const line = read(reclassified.path).find((l) => l.kind === "posting")!;
    expect(line).toMatchObject({ id: "j1", classification: "out" });
    expect(line).not.toHaveProperty("text");
    commitArchive(db, reclassified.file);

    db.prepare("UPDATE jobs SET is_closed = 1, last_seen_at = '2026-11-23T23:00:00.000Z' WHERE id = 'j1'").run();
    const closed = await exportArchive(db, run("2026-11-24T23:10:00.000Z"), out);
    expect(read(closed.path).find((l) => l.kind === "posting")).toMatchObject({ isClosed: true, lastSeenAt: "2026-11-23T23:00:00.000Z" });
  });

  it("sends the text again when the advert itself is rewritten", async () => {
    const db = makeDb();
    addJob(db, "j1");
    const out = dir();
    commitArchive(db, (await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out)).file);
    db.prepare("UPDATE jobs SET description_text = 'Build agents and evals.', content_hash = 'hash-2' WHERE id = 'j1'").run();
    const next = await exportArchive(db, run("2026-11-22T23:10:00.000Z"), out);
    expect(read(next.path).find((l) => l.kind === "posting")).toMatchObject({ text: "Build agents and evals.", contentHash: "hash-2" });
  });

  it("writes the same rows again until an upload is confirmed", async () => {
    const db = makeDb();
    addJob(db, "j1");
    const out = dir();
    const first = await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out);
    expect(archiveBacklog(db)).toBe(1);
    // The upload failed; nothing was committed. Tomorrow tries again, text and all.
    const second = await exportArchive(db, run("2026-11-22T23:10:00.000Z"), out);
    expect(second).toMatchObject({ postings: 1, withText: 1 });
    // A late commit of the superseded file confirms nothing.
    expect(commitArchive(db, first.file)).toBe(0);
    expect(commitArchive(db, second.file)).toBe(1);
    expect(archiveBacklog(db)).toBe(0);
    expect((await exportArchive(db, run("2026-11-23T23:10:00.000Z"), out)).postings).toBe(0);
  });
});

describe("archive guards", () => {
  const OLD = "2026-01-01T00:00:00.000Z";

  it("keeps an out-of-scope advert's text until the archive has confirmed it", async () => {
    const db = makeDb();
    addJob(db, "j1", { classification: "out" });
    expect(dropOutOfScopeText(db, { onlyArchived: true })).toBe(0);
    const out = await exportArchive(db, run("2026-11-21T23:10:00.000Z"), dir());
    expect(dropOutOfScopeText(db, { onlyArchived: true })).toBe(0); // written, not yet stored
    commitArchive(db, out.file);
    expect(dropOutOfScopeText(db, { onlyArchived: true })).toBe(1);
  });

  it("holds the text of a rewritten advert until that version is archived too", async () => {
    const db = makeDb();
    addJob(db, "j1", { classification: "out" });
    commitArchive(db, (await exportArchive(db, run("2026-11-21T23:10:00.000Z"), dir())).file);
    db.prepare("UPDATE jobs SET description_text = 'New advert.', content_hash = 'hash-2' WHERE id = 'j1'").run();
    expect(dropOutOfScopeText(db, { onlyArchived: true })).toBe(0);
  });

  it("deletes a long-closed role only once its closure is in the archive", async () => {
    const db = makeDb();
    addJob(db, "j1", { isClosed: 1, lastSeen: OLD });
    expect(pruneClosedJobs(db, 90, { onlyArchived: true })).toBe(0);
    commitArchive(db, (await exportArchive(db, run("2026-11-21T23:10:00.000Z"), dir())).file);
    expect(pruneClosedJobs(db, 90, { onlyArchived: true })).toBe(1);
  });

  it("changes nothing for a database that is not being archived", () => {
    const db = makeDb();
    addJob(db, "j1", { classification: "out" });
    addJob(db, "j2", { isClosed: 1, lastSeen: OLD });
    expect(dropOutOfScopeText(db)).toBe(1);
    expect(pruneClosedJobs(db, 90)).toBe(1);
  });
});

describe("loadInto", () => {
  it("rebuilds every version, the text, the coverage log and the periods each posting was open", async () => {
    const db = makeDb();
    const out = dir();
    addJob(db, "j1", { ingested: "2026-11-01T23:00:00.000Z" });
    addJob(db, "j2", { classification: "out", text: "Reconcile ledgers." });
    commitArchive(db, (await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out)).file);

    // j1 closes, then comes back a week later.
    db.prepare("UPDATE jobs SET is_closed = 1, last_seen_at = '2026-11-25T23:00:00.000Z' WHERE id = 'j1'").run();
    commitArchive(db, (await exportArchive(db, run("2026-11-27T23:10:00.000Z"), out)).file);
    db.prepare("UPDATE jobs SET is_closed = 0, last_seen_at = '2026-12-04T23:00:00.000Z' WHERE id = 'j1'").run();
    commitArchive(db, (await exportArchive(db, run("2026-12-04T23:10:00.000Z"), out)).file);

    const history = new DatabaseSync(":memory:");
    const result = await loadInto(history, out);
    expect(result).toMatchObject({ runs: 3, postings: 2, versions: 4, incomplete: [] });

    const all = (sql: string) => history.prepare(sql).all();
    expect(all("SELECT run_at, classifier, complete FROM runs ORDER BY run_at")).toHaveLength(3);
    expect(all("SELECT status FROM source_runs WHERE source_id = 'src_a'")).toHaveLength(3);
    expect(all("SELECT as_of, is_closed FROM posting_versions WHERE id = 'j1' ORDER BY as_of")).toEqual([
      { as_of: "2026-11-21T23:10:00.000Z", is_closed: 0 },
      { as_of: "2026-11-27T23:10:00.000Z", is_closed: 1 },
      { as_of: "2026-12-04T23:10:00.000Z", is_closed: 0 },
    ]);
    expect(all("SELECT seq, seen_from, seen_to FROM posting_spans WHERE id = 'j1' ORDER BY seq")).toEqual([
      { seq: 0, seen_from: "2026-11-01T23:00:00.000Z", seen_to: "2026-11-25T23:00:00.000Z" },
      { seq: 1, seen_from: "2026-12-04T23:10:00.000Z", seen_to: null },
    ]);
    expect(all("SELECT text FROM posting_text WHERE id = 'j2'")).toEqual([{ text: "Reconcile ledgers." }]);
    expect(all("SELECT id, is_closed FROM postings ORDER BY id")).toEqual([
      { id: "j1", is_closed: 0 },
      { id: "j2", is_closed: 0 },
    ]);
  });

  it("survives the line-separator characters real adverts contain", async () => {
    const db = makeDb();
    const out = dir();
    const text = "Line one.\u2028Line two.\u2029Line three.\r\nLine four.";
    addJob(db, "j1", { text });
    const result = await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out);
    // Newline is the only line break in the file.
    expect(gunzipSync(readFileSync(result.path)).toString("utf8")).not.toMatch(/[\u2028\u2029\r]/);
    const history = new DatabaseSync(":memory:");
    await loadInto(history, out);
    expect(history.prepare("SELECT text FROM posting_text").all()).toEqual([{ text }]);
  });

  it("keeps a version once when a failed commit made the engine write it twice", async () => {
    const db = makeDb();
    const out = dir();
    addJob(db, "j1");
    await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out); // uploaded, never committed
    await exportArchive(db, run("2026-11-22T23:10:00.000Z"), out);
    const history = new DatabaseSync(":memory:");
    expect(await loadInto(history, out)).toMatchObject({ runs: 2, versions: 1 });
  });

  it("gives a role first seen already closed the span it was actually open", async () => {
    const db = makeDb();
    const out = dir();
    addJob(db, "j1", { isClosed: 1, ingested: "2026-09-01T23:00:00.000Z", lastSeen: "2026-10-01T23:00:00.000Z" });
    await exportArchive(db, run("2026-11-21T23:10:00.000Z"), out);
    const history = new DatabaseSync(":memory:");
    await loadInto(history, out);
    expect(history.prepare("SELECT seen_from, seen_to FROM posting_spans").all()).toEqual([
      { seen_from: "2026-09-01T23:00:00.000Z", seen_to: "2026-10-01T23:00:00.000Z" },
    ]);
  });
});
