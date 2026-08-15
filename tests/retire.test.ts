import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { retireSourcesExcept } from "../engine/src/db/repo.ts";

/** Minimal stand-in for the parts of the schema retirement touches. */
function dbWith(sources: string[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sources (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, source_id TEXT,
      is_direct INTEGER NOT NULL DEFAULT 0, is_closed INTEGER NOT NULL DEFAULT 0
    );
  `);
  for (const s of sources) {
    db.prepare(`INSERT INTO sources (id, status) VALUES (?, 'active')`).run(s);
    db.prepare(`INSERT INTO jobs (id, source_id) VALUES (?, ?)`).run(`j_${s}`, s);
  }
  return db;
}

const statusOf = (db: DatabaseSync, id: string) =>
  (db.prepare(`SELECT status FROM sources WHERE id = ?`).get(id) as { status: string }).status;
const closedOf = (db: DatabaseSync, id: string) =>
  (db.prepare(`SELECT is_closed FROM jobs WHERE id = ?`).get(`j_${id}`) as { is_closed: number })
    .is_closed;

describe("retireSourcesExcept", () => {
  it("retires sources the seed no longer lists and closes their jobs", () => {
    const db = dbWith(["a", "b", "c", "d"]);
    expect(retireSourcesExcept(db, ["a", "b", "c"], 0.5)).toBe(1);
    expect(statusOf(db, "d")).toBe("retired");
    expect(closedOf(db, "d")).toBe(1);
  });

  it("leaves listed sources and their jobs alone", () => {
    const db = dbWith(["a", "b", "c", "d"]);
    retireSourcesExcept(db, ["a", "b", "c"], 0.5);
    expect(statusOf(db, "a")).toBe("active");
    expect(closedOf(db, "a")).toBe(0);
  });

  it("is a no-op when the seed still lists everything", () => {
    const db = dbWith(["a", "b"]);
    expect(retireSourcesExcept(db, ["a", "b"], 0.5)).toBe(0);
  });

  it("refuses a truncated seed file rather than retiring the whole board", () => {
    const db = dbWith(["a", "b", "c", "d"]);
    expect(retireSourcesExcept(db, ["a"], 0.5)).toBeNull();
    expect(statusOf(db, "d")).toBe("active");
    expect(closedOf(db, "d")).toBe(0);
  });

  it("never reopens or re-closes a direct posting", () => {
    const db = dbWith(["a", "b"]);
    db.prepare(`UPDATE jobs SET is_direct = 1 WHERE source_id = 'b'`).run();
    retireSourcesExcept(db, ["a"], 0.5);
    expect(statusOf(db, "b")).toBe("retired");
    expect(closedOf(db, "b")).toBe(0); // direct postings are not feed-owned
  });

  it("leaves a paused source alone while the seed still lists it", () => {
    const db = dbWith(["a", "b"]);
    db.prepare(`UPDATE sources SET status = 'paused' WHERE id = 'b'`).run();
    expect(retireSourcesExcept(db, ["a", "b"], 0.5)).toBe(0);
    expect(statusOf(db, "b")).toBe("paused");
    expect(closedOf(db, "b")).toBe(0);
  });

  it("still retires a paused source once the seed stops listing it", () => {
    // Dooming only 'active' rows would strand a paused source, and its open
    // jobs, for good — nothing else would ever close them.
    const db = dbWith(["a", "b"]);
    db.prepare(`UPDATE sources SET status = 'paused' WHERE id = 'b'`).run();
    expect(retireSourcesExcept(db, ["a"], 0.5)).toBe(1);
    expect(statusOf(db, "b")).toBe("retired");
    expect(closedOf(db, "b")).toBe(1);
  });

  it("counts paused sources in the truncated-file guard", () => {
    // Paused sources are still listed in the file, so they belong in the
    // denominator; excluding them would make the guard easier to trip.
    const db = dbWith(["a", "b", "c", "d"]);
    db.prepare(`UPDATE sources SET status = 'paused' WHERE id IN ('c','d')`).run();
    expect(retireSourcesExcept(db, ["a"], 0.5)).toBeNull();
    expect(statusOf(db, "d")).toBe("paused");
  });
});
