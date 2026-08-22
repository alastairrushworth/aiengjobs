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
};

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
