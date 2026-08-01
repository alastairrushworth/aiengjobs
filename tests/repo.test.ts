import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { closeStaleJobs } from "../engine/src/db/repo.ts";

const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");
const RUN_START = "2026-08-01T03:30:00.000Z";
const BEFORE = "2026-07-31T03:30:00.000Z";

/** In-memory DB with two companies, one source each, and no jobs yet. */
function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  // WAL is meaningless in memory and the schema sets it; harmless either way.
  db.exec(SCHEMA);
  for (const c of ["a", "b"]) {
    db.prepare(
      "INSERT INTO companies (id, name, slug, ats_provider) VALUES (?, ?, ?, 'greenhouse')",
    ).run(`co_${c}`, `Company ${c}`, c);
    db.prepare(
      "INSERT INTO sources (id, company_id, ats_provider, endpoint_url) VALUES (?, ?, 'greenhouse', 'https://x')",
    ).run(`src_${c}`, `co_${c}`);
  }
  return db;
}

function addJob(
  db: DatabaseSync,
  id: string,
  source: string,
  opts: { lastSeen?: string | null; isDirect?: number; isClosed?: number } = {},
): void {
  db.prepare(
    `INSERT INTO jobs (id, company_id, source_id, slug, title, normalized_title,
                       apply_url, is_direct, is_closed, last_seen_at)
     VALUES (?, ?, ?, ?, 'Engineer', 'engineer', 'https://x/apply', ?, ?, ?)`,
  ).run(
    id,
    `co_${source.replace("src_", "")}`,
    source,
    id,
    opts.isDirect ?? 0,
    opts.isClosed ?? 0,
    opts.lastSeen === undefined ? BEFORE : opts.lastSeen,
  );
}

const isClosed = (db: DatabaseSync, id: string) =>
  (db.prepare("SELECT is_closed c FROM jobs WHERE id = ?").get(id) as { c: number }).c;

describe("closeStaleJobs", () => {
  it("closes stale jobs and reports the count per source", () => {
    const db = makeDb();
    addJob(db, "j1", "src_a");
    addJob(db, "j2", "src_a");
    addJob(db, "j3", "src_b");

    const bySource = closeStaleJobs(db, RUN_START, ["src_a", "src_b"]);

    expect(bySource.get("src_a")).toBe(2);
    expect(bySource.get("src_b")).toBe(1);
    // The breakdown must describe rows that were really written, not just matched.
    expect(isClosed(db, "j1")).toBe(1);
    expect(isClosed(db, "j3")).toBe(1);
  });

  it("omits sources that closed nothing rather than reporting them as zero", () => {
    const db = makeDb();
    addJob(db, "j1", "src_a");
    addJob(db, "j2", "src_b", { lastSeen: RUN_START });

    const bySource = closeStaleJobs(db, RUN_START, ["src_a", "src_b"]);

    expect([...bySource.keys()]).toEqual(["src_a"]);
    expect(isClosed(db, "j2")).toBe(0);
  });

  it("leaves jobs from sources that were not polled alone", () => {
    const db = makeDb();
    addJob(db, "j1", "src_a");
    addJob(db, "j2", "src_b");

    // src_b failed to fetch this run, so its jobs must not be treated as vanished.
    const bySource = closeStaleJobs(db, RUN_START, ["src_a"]);

    expect(bySource.get("src_a")).toBe(1);
    expect(bySource.has("src_b")).toBe(false);
    expect(isClosed(db, "j2")).toBe(0);
  });

  it("never closes direct jobs", () => {
    const db = makeDb();
    addJob(db, "j1", "src_a", { isDirect: 1 });

    expect(closeStaleJobs(db, RUN_START, ["src_a"]).size).toBe(0);
    expect(isClosed(db, "j1")).toBe(0);
  });

  it("closes jobs that were never seen at all", () => {
    const db = makeDb();
    addJob(db, "j1", "src_a", { lastSeen: null });

    expect(closeStaleJobs(db, RUN_START, ["src_a"]).get("src_a")).toBe(1);
  });

  it("does not re-count jobs that were already closed", () => {
    const db = makeDb();
    addJob(db, "j1", "src_a", { isClosed: 1 });

    expect(closeStaleJobs(db, RUN_START, ["src_a"]).size).toBe(0);
  });

  it("returns an empty breakdown when nothing was polled", () => {
    const db = makeDb();
    addJob(db, "j1", "src_a");

    expect(closeStaleJobs(db, RUN_START, []).size).toBe(0);
    expect(isClosed(db, "j1")).toBe(0);
  });
});
