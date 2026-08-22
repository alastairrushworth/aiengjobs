import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  closeStaleJobs,
  dropOutOfScopeText,
  listPollTargets,
  markSourcePolled,
} from "../engine/src/db/repo.ts";

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

describe("listPollTargets", () => {
  /** Give `slug` its own company + source, optionally already polled. */
  function addSource(db: DatabaseSync, slug: string, lastPolled?: string): void {
    db.prepare(
      "INSERT INTO companies (id, name, slug, ats_provider) VALUES (?, ?, ?, 'greenhouse')",
    ).run(`co_${slug}`, `Company ${slug}`, slug);
    db.prepare(
      `INSERT INTO sources (id, company_id, ats_provider, endpoint_url, last_polled_at)
       VALUES (?, ?, 'greenhouse', 'https://x', ?)`,
    ).run(`src_${slug}`, `co_${slug}`, lastPolled ?? null);
  }

  it("puts never-polled sources first, then the least recently polled", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    addSource(db, "recent", "2026-08-03T00:00:00.000Z");
    addSource(db, "stale", "2026-08-01T00:00:00.000Z");
    addSource(db, "fresh"); // never polled
    addSource(db, "middling", "2026-08-02T00:00:00.000Z");

    expect(listPollTargets(db).map((t) => t.sourceId)).toEqual([
      "src_fresh",
      "src_stale",
      "src_middling",
      "src_recent",
    ]);
  });

  /**
   * The regression this ordering exists for: with no ORDER BY the queue was
   * stable, so a run that ran out of budget dropped the same tail every night.
   * Polling the head has to move it behind the sources it displaced.
   */
  it("rotates: polling a source sends it to the back of the queue", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    for (const s of ["a", "b", "c"]) addSource(db, s);

    // Night one polls only the first two before the budget runs out.
    const first = listPollTargets(db).map((t) => t.sourceId);
    expect(first).toEqual(["src_a", "src_b", "src_c"]);
    markSourcePolled(db, "src_a", "2026-08-01T00:00:00.000Z");
    markSourcePolled(db, "src_b", "2026-08-01T00:01:00.000Z");

    // Night two starts with the one that missed out, not with src_a again.
    expect(listPollTargets(db).map((t) => t.sourceId)).toEqual([
      "src_c",
      "src_a",
      "src_b",
    ]);
  });

  it("leaves paused and retired sources out entirely", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    addSource(db, "live");
    addSource(db, "off");
    db.prepare("UPDATE sources SET status = 'paused' WHERE id = 'src_off'").run();

    expect(listPollTargets(db).map((t) => t.sourceId)).toEqual(["src_live"]);
  });

  it("falls back to the company slug when a source carries no ATS token", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    addSource(db, "tokenless");

    expect(listPollTargets(db)[0]!.atsToken).toBe("tokenless");
  });
});

/**
 * The other half of the database's growth. `pruneClosedJobs` only reaches roles
 * that closed; an advert the classifier ruled out stays open at its ATS for
 * months, so pruning never sees it, and it was keeping the full text twice.
 */
describe("dropOutOfScopeText", () => {
  function makeTextDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    db.prepare(
      "INSERT INTO companies (id, name, slug, ats_provider) VALUES ('co', 'Co', 'co', 'greenhouse')",
    ).run();
    return db;
  }

  const addTexted = (db: DatabaseSync, id: string, classification: string) =>
    db
      .prepare(
        `INSERT INTO jobs (id, company_id, slug, title, normalized_title, apply_url,
                           description_html, description_text, content_hash, classification)
         VALUES (?, 'co', ?, 'T', 't', 'https://x', '<p>body</p>', 'body', 'hash-1', ?)`,
      )
      .run(id, id, classification);

  const textOf = (db: DatabaseSync, id: string) =>
    db
      .prepare(
        "SELECT description_html AS h, description_text AS t, content_hash AS c FROM jobs WHERE id = ?",
      )
      .get(id) as { h: string | null; t: string | null; c: string | null };

  it("empties both description columns on out-of-scope rows", () => {
    const db = makeTextDb();
    addTexted(db, "out", "out");

    expect(dropOutOfScopeText(db)).toBe(1);
    expect(textOf(db, "out")).toMatchObject({ h: null, t: null });
  });

  it("keeps the content hash, which is what ingest still needs", () => {
    // Without it every out-of-scope advert would look changed and be re-scored
    // on every run — the exact cost the skip exists to avoid.
    const db = makeTextDb();
    addTexted(db, "out", "out");

    dropOutOfScopeText(db);

    expect(textOf(db, "out").c).toBe("hash-1");
  });

  it("never touches an in-scope row", () => {
    const db = makeTextDb();
    addTexted(db, "in", "in");

    expect(dropOutOfScopeText(db)).toBe(0);
    expect(textOf(db, "in")).toMatchObject({ h: "<p>body</p>", t: "body" });
  });

  it("is idempotent — a second pass reports nothing left to do", () => {
    const db = makeTextDb();
    addTexted(db, "out", "out");

    expect(dropOutOfScopeText(db)).toBe(1);
    expect(dropOutOfScopeText(db)).toBe(0);
  });
});
