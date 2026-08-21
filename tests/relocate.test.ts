import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");

const dirs: string[] = [];

/** A throwaway on-disk database — relocate opens it through AIENGJOBS_DB. */
function makeDb(rows: [id: string, locationRaw: string | null, country: string | null][]): string {
  const dir = mkdtempSync(join(tmpdir(), "relocate-"));
  dirs.push(dir);
  const path = join(dir, "test.db");
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO companies (id, name, slug, ats_provider) VALUES ('co', 'Co', 'co', 'greenhouse')",
  ).run();
  db.prepare(
    "INSERT INTO sources (id, company_id, ats_provider, endpoint_url) VALUES ('src', 'co', 'greenhouse', 'https://x')",
  ).run();
  for (const [id, locationRaw, country] of rows) {
    db.prepare(
      `INSERT INTO jobs (id, company_id, source_id, slug, title, normalized_title,
                         apply_url, location_raw, country, is_direct, is_closed, last_seen_at)
       VALUES (?, 'co', 'src', ?, 'AI Engineer', 'ai engineer', 'https://x/apply', ?, ?, 0, 0, '2026-08-01T00:00:00Z')`,
    ).run(id, id, locationRaw, country);
  }
  db.close();
  return path;
}

function countries(path: string): Record<string, string | null> {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare("SELECT id, country FROM jobs ORDER BY id").all() as unknown as {
    id: string;
    country: string | null;
  }[];
  db.close();
  return Object.fromEntries(rows.map((r) => [r.id, r.country]));
}

/** db/index.ts resolves AIENGJOBS_DB once, at load, so each run needs a fresh
 *  module registry to pick up this test's database. */
async function run(path: string, opts: { dryRun?: boolean } = {}): Promise<void> {
  process.env.AIENGJOBS_DB = path;
  vi.resetModules();
  const { relocate } = await import("../engine/src/relocate.ts");
  relocate(opts);
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.AIENGJOBS_DB;
});

describe("relocate", () => {
  it("fills a blank country from the current hint table", async () => {
    const path = makeDb([
      ["sf", "sf", null],
      ["belfast", "Belfast", null],
      ["nyc", "NYC Office", null],
    ]);

    await run(path);

    expect(countries(path)).toEqual({ sf: "US", belfast: "GB", nyc: "US" });
  });

  it("never overwrites a country already stored", async () => {
    // The retired LLM extractor filled countries that location_raw alone cannot
    // reproduce. A blanket re-parse blanks 43 of them on the live board —
    // "Chengdu" → CN, "Quito, Ecuador" → EC — losing more markup than the pass
    // recovers, so a row that has a country is never touched.
    const path = makeDb([
      ["chengdu", "Chengdu", "CN"],
      ["quito", "Quito, Ecuador", "EC"],
      // Stored value disagrees with what the parser would say: still untouched.
      ["odd", "London", "FR"],
    ]);

    await run(path);

    expect(countries(path)).toEqual({ chengdu: "CN", quito: "EC", odd: "FR" });
  });

  it("leaves a row alone when the location yields no country", async () => {
    const path = makeDb([
      ["nowhere", "European Union", null],
      ["blank", null, null],
    ]);

    await run(path);

    expect(countries(path)).toEqual({ nowhere: null, blank: null });
  });

  it("writes nothing on a dry run", async () => {
    const path = makeDb([["sf", "sf", null]]);

    await run(path, { dryRun: true });

    expect(countries(path)).toEqual({ sf: null });
  });
});
