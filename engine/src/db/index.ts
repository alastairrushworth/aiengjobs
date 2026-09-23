import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUSTERS } from "@aiengjobs/shared/taxonomy";
import { slugify } from "../util/id.ts";

const here = dirname(fileURLToPath(import.meta.url));

// DB lives outside the repo by default (engine/data/ is gitignored). Override
// with AIENGJOBS_DB — the nightly workflow points it at the runner workspace.
export const DB_PATH =
  process.env.AIENGJOBS_DB ?? join(here, "..", "..", "data", "aiengjobs.db");

/**
 * Columns added to `jobs` after the schema first shipped, and the ALTER that
 * adds each one.
 *
 * schema.sql cannot carry these on its own. It is applied with CREATE TABLE IF
 * NOT EXISTS, which leaves an existing table entirely alone — so a column added
 * there reaches a fresh database and never reaches the nightly one, which is
 * restored from a release asset and has been carried forward since before the
 * column existed. That gap is silent: the engine would keep writing and the new
 * column would simply never be there.
 */
const JOB_COLUMNS_ADDED_LATER: Record<string, string> = {
  model_score: "ALTER TABLE jobs ADD COLUMN model_score REAL",
  delisted_at: "ALTER TABLE jobs ADD COLUMN delisted_at TEXT",
};

/**
 * Triggers on `jobs`, created with the same IF NOT EXISTS idempotence as the
 * columns above and for the same reason: the nightly database predates them.
 *
 * `delisted_at` records the moment a role's classification goes in → out
 * (see schema.sql). Three different statements rewrite classification —
 * ingest's upsert, retag's demote, reclassify's update — and a rule kept in
 * three places is a rule one refactor away from being kept in two. A trigger
 * is the one place. Both fire only on a real transition: the upsert restates
 * classification on every re-poll, and an in → in or out → out "update" must
 * neither stamp nor clear anything.
 */
const JOB_TRIGGERS: Record<string, string> = {
  jobs_delisted: `
    CREATE TRIGGER IF NOT EXISTS jobs_delisted
    AFTER UPDATE OF classification ON jobs
    FOR EACH ROW WHEN OLD.classification = 'in' AND NEW.classification = 'out'
    BEGIN
      UPDATE jobs SET delisted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
    END`,
  jobs_relisted: `
    CREATE TRIGGER IF NOT EXISTS jobs_relisted
    AFTER UPDATE OF classification ON jobs
    FOR EACH ROW WHEN OLD.classification = 'out' AND NEW.classification = 'in'
    BEGIN
      UPDATE jobs SET delisted_at = NULL WHERE id = NEW.id;
    END`,
};

/**
 * Tables the first schema reserved for features that were never built — paid
 * posts, a newsletter, accounts — and that nothing reads or writes. They are
 * dropped rather than left empty because this database is published: the
 * nightly run uploads it as the public `db-latest` release asset, so the first
 * row anyone ever wrote to them would be world-readable the next morning.
 */
export const RETIRED_TABLES = ["employer_orders", "subscribers", "users"] as const;

/**
 * Bring an existing database up to the current schema. Idempotent, and cheap
 * enough (one PRAGMA) to run on every open — which is the point: no code path
 * should be able to reach a table that is missing a column the engine writes.
 */
export function migrate(db: DatabaseSync): void {
  const present = new Set(
    (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  // Empty on a database that has not been initialised yet (no jobs table).
  // initDb runs the schema, which already has every column, so there is nothing
  // to add — and issuing an ALTER here would throw.
  if (present.size === 0) return;
  for (const [column, sql] of Object.entries(JOB_COLUMNS_ADDED_LATER)) {
    if (!present.has(column)) {
      db.exec(sql);
      console.log(`  migrated: added jobs.${column}`);
    }
  }
  for (const sql of Object.values(JOB_TRIGGERS)) db.exec(sql);
  for (const table of RETIRED_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
}

export function openDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

/** Create the schema (idempotent) and seed the skills table from the taxonomy. */
export function initDb(): void {
  const db = openDb();
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(schema);
  // openDb's migrate found no jobs table and stood down; now there is one,
  // and it needs its triggers.
  migrate(db);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO skills (id, name, cluster) VALUES (?, ?, ?)",
  );
  for (const cluster of CLUSTERS) {
    for (const name of cluster.skills) {
      insert.run(`sk_${slugify(name)}`, name, cluster.id);
    }
  }

  const { n } = db.prepare("SELECT COUNT(*) AS n FROM skills").get() as {
    n: number;
  };
  db.close();
  console.log(`Initialised database at ${DB_PATH} (${n} skills seeded)`);
}
