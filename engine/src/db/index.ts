import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUSTERS } from "@aiengjobs/shared/taxonomy";

const here = dirname(fileURLToPath(import.meta.url));

// DB lives outside the repo by default (engine/data/ is gitignored). Override
// with AIENGJOBS_DB on the droplet (e.g. /var/lib/aiengjobs/aiengjobs.db).
export const DB_PATH =
  process.env.AIENGJOBS_DB ?? join(here, "..", "..", "data", "aiengjobs.db");

export function openDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
