import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { migrate } from "../engine/src/db/index.ts";
import { upsertJob } from "../engine/src/db/repo.ts";

const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");

/** Columns currently on the jobs table. */
function columns(db: DatabaseSync): string[] {
  return (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
}

/**
 * The schema as it stood before a column was added, which is what the nightly
 * database actually looks like: it is restored from a release asset every run
 * and has been carried forward since long before this column existed.
 */
function legacyDb(without: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(
    SCHEMA.split("\n")
      .filter((line) => !line.trim().startsWith(without))
      .join("\n")
      // Dropping the table's last column leaves "…TEXT, -- note\n  -- more\n)"
      // behind: a comma with nothing but whole comment lines between it and
      // a ")" that opens its own line. (Anchored to line starts because the
      // comments themselves contain parentheses.)
      .replace(/,((?:[ \t]*--[^\n]*)?(?:\n[ \t]*--[^\n]*)*\n[ \t]*\))/g, "$1"),
  );
  return db;
}

describe("migrate", () => {
  it("adds a column an existing database is missing", () => {
    const db = legacyDb("model_score");
    expect(columns(db)).not.toContain("model_score");
    migrate(db);
    expect(columns(db)).toContain("model_score");
    db.close();
  });

  it("is idempotent", () => {
    const db = legacyDb("model_score");
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(columns(db).filter((c) => c === "model_score")).toHaveLength(1);
    db.close();
  });

  it("leaves a current database alone", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    const before = columns(db);
    migrate(db);
    expect(columns(db)).toEqual(before);
    db.close();
  });

  it("adds delisted_at to a database that predates it", () => {
    const db = legacyDb("delisted_at");
    expect(columns(db)).not.toContain("delisted_at");
    migrate(db);
    expect(columns(db)).toContain("delisted_at");
    db.close();
  });

  it("does nothing on a database with no jobs table yet", () => {
    // openDb runs this before initDb has applied the schema, and an ALTER
    // against a table that does not exist throws.
    const db = new DatabaseSync(":memory:");
    expect(() => migrate(db)).not.toThrow();
    db.close();
  });

  it("preserves the rows that were already there", () => {
    const db = legacyDb("model_score");
    db.prepare(
      "INSERT INTO companies (id, name, slug, ats_provider) VALUES ('co', 'Acme', 'acme', 'greenhouse')",
    ).run();
    db.prepare(
      `INSERT INTO jobs (id, company_id, slug, title, normalized_title, apply_url, ingested_at)
       VALUES ('j1', 'co', 'a', 'AI Engineer', 'ai engineer', 'https://x', '2026-08-01T00:00:00Z')`,
    ).run();
    migrate(db);
    const row = db.prepare("SELECT title, model_score FROM jobs WHERE id = 'j1'").get() as {
      title: string;
      model_score: number | null;
    };
    expect(row.title).toBe("AI Engineer");
    // Backfilled by a reclassify pass, not by the migration — a value invented
    // here would be indistinguishable from one the model produced.
    expect(row.model_score).toBeNull();
    db.close();
  });
});

describe("upsertJob and model_score", () => {
  const base = {
    id: "j1",
    companyId: "co",
    sourceId: "src",
    externalId: "1",
    slug: "ai-engineer",
    title: "AI Engineer",
    normalizedTitle: "ai engineer",
    applyUrl: "https://acme.example/1",
    classification: "in",
    ingestedAt: "2026-08-01T00:00:00Z",
    contentHash: "h1",
    dedupKey: "k1",
    lastSeenAt: "2026-08-01T00:00:00Z",
  };

  function db(): DatabaseSync {
    const d = new DatabaseSync(":memory:");
    d.exec(SCHEMA);
    d.prepare("INSERT INTO companies (id, name, slug, ats_provider) VALUES ('co', 'Acme', 'acme', 'greenhouse')").run();
    d.prepare(
      "INSERT INTO sources (id, company_id, ats_provider, endpoint_url) VALUES ('src','co','greenhouse','https://x')",
    ).run();
    return d;
  }

  const score = (d: DatabaseSync) =>
    (d.prepare("SELECT model_score FROM jobs WHERE id = 'j1'").get() as {
      model_score: number | null;
    }).model_score;

  it("stores the score it is given", () => {
    const d = db();
    upsertJob(d, { ...base, modelScore: 0.93 });
    expect(score(d)).toBeCloseTo(0.93);
    d.close();
  });

  it("keeps an existing score when a re-poll brings none", () => {
    // A posting whose content hash is unchanged skips inference entirely and
    // arrives with no score. Overwriting with null on every such night would
    // empty the column for exactly the roles that have been listed longest.
    const d = db();
    upsertJob(d, { ...base, modelScore: 0.93 });
    upsertJob(d, { ...base, contentHash: "h1", lastSeenAt: "2026-08-02T00:00:00Z" });
    expect(score(d)).toBeCloseTo(0.93);
    d.close();
  });

  it("replaces the score when the advert changed and was re-scored", () => {
    const d = db();
    upsertJob(d, { ...base, modelScore: 0.93 });
    upsertJob(d, { ...base, contentHash: "h2", modelScore: 0.41 });
    expect(score(d)).toBeCloseTo(0.41);
    d.close();
  });
});

describe("delisted_at", () => {
  const base = {
    id: "j1",
    companyId: "co",
    sourceId: "src",
    externalId: "1",
    slug: "ai-engineer",
    title: "AI Engineer",
    normalizedTitle: "ai engineer",
    applyUrl: "https://acme.example/1",
    classification: "in",
    ingestedAt: "2026-08-01T00:00:00Z",
    contentHash: "h1",
    dedupKey: "k1",
    lastSeenAt: "2026-08-01T00:00:00Z",
  };

  function db(): DatabaseSync {
    const d = new DatabaseSync(":memory:");
    d.exec(SCHEMA);
    // The triggers live in migrate, not the schema, because the nightly
    // database predates them — so this is the path that installs them.
    migrate(d);
    d.prepare("INSERT INTO companies (id, name, slug, ats_provider) VALUES ('co', 'Acme', 'acme', 'greenhouse')").run();
    d.prepare(
      "INSERT INTO sources (id, company_id, ats_provider, endpoint_url) VALUES ('src','co','greenhouse','https://x')",
    ).run();
    return d;
  }

  const delistedAt = (d: DatabaseSync) =>
    (d.prepare("SELECT delisted_at FROM jobs WHERE id = 'j1'").get() as {
      delisted_at: string | null;
    }).delisted_at;

  it("is stamped when a re-poll reclassifies a listed role out", () => {
    // ingest's upsert is the path that demotes an edited posting; the
    // trigger sees the transition without the upsert knowing about it.
    const d = db();
    upsertJob(d, base);
    expect(delistedAt(d)).toBeNull();
    upsertJob(d, { ...base, classification: "out", contentHash: "h2" });
    expect(delistedAt(d)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    d.close();
  });

  it("is not stamped by a re-poll that keeps the classification", () => {
    const d = db();
    upsertJob(d, base);
    upsertJob(d, { ...base, lastSeenAt: "2026-08-02T00:00:00Z" });
    expect(delistedAt(d)).toBeNull();
    d.close();
  });

  it("is never stamped for a role that was out from the start", () => {
    const d = db();
    upsertJob(d, { ...base, classification: "out" });
    upsertJob(d, { ...base, classification: "out", lastSeenAt: "2026-08-02T00:00:00Z" });
    expect(delistedAt(d)).toBeNull();
    d.close();
  });

  it("is cleared when the role is reclassified back in", () => {
    const d = db();
    upsertJob(d, base);
    upsertJob(d, { ...base, classification: "out", contentHash: "h2" });
    expect(delistedAt(d)).not.toBeNull();
    d.prepare("UPDATE jobs SET classification = 'in' WHERE id = 'j1'").run();
    expect(delistedAt(d)).toBeNull();
    d.close();
  });

  it("fires from a plain UPDATE too, which is how retag and reclassify demote", () => {
    const d = db();
    upsertJob(d, base);
    d.prepare("UPDATE jobs SET classification = 'out' WHERE id = 'j1'").run();
    expect(delistedAt(d)).not.toBeNull();
    d.close();
  });

  it("installs the triggers idempotently", () => {
    const d = db();
    expect(() => migrate(d)).not.toThrow();
    const triggers = (
      d.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    expect(triggers).toEqual(["jobs_delisted", "jobs_relisted"]);
    d.close();
  });
});
