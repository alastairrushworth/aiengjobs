import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");

const dirs: string[] = [];

interface Row {
  id: string;
  locationRaw: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
}

/** A throwaway on-disk database — relocate opens it through AIENGJOBS_DB. */
function makeDb(rows: Row[]): string {
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
  for (const r of rows) {
    db.prepare(
      `INSERT INTO jobs (id, company_id, source_id, slug, title, normalized_title,
                         apply_url, location_raw, country, region, city,
                         is_direct, is_closed, last_seen_at)
       VALUES (?, 'co', 'src', ?, 'AI Engineer', 'ai engineer', 'https://x/apply', ?, ?, ?, ?, 0, 0, '2026-08-01T00:00:00Z')`,
    ).run(r.id, r.id, r.locationRaw, r.country ?? null, r.region ?? null, r.city ?? null);
  }
  db.close();
  return path;
}

function read(path: string, column: "country" | "region"): Record<string, string | null> {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(`SELECT id, ${column} AS v FROM jobs ORDER BY id`).all() as unknown as {
    id: string;
    v: string | null;
  }[];
  db.close();
  return Object.fromEntries(rows.map((r) => [r.id, r.v]));
}

const countries = (path: string): Record<string, string | null> => read(path, "country");
const regions = (path: string): Record<string, string | null> => read(path, "region");

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
      { id: "sf", locationRaw: "sf" },
      { id: "belfast", locationRaw: "Belfast" },
      { id: "nyc", locationRaw: "NYC Office" },
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
      { id: "chengdu", locationRaw: "Chengdu", country: "CN" },
      { id: "quito", locationRaw: "Quito, Ecuador", country: "EC" },
      // Stored value disagrees with what the parser would say: still untouched.
      { id: "odd", locationRaw: "London", country: "FR" },
    ]);

    await run(path);

    expect(countries(path)).toEqual({ chengdu: "CN", quito: "EC", odd: "FR" });
  });

  it("leaves a row alone when the location yields no country", async () => {
    const path = makeDb([
      { id: "nowhere", locationRaw: "European Union" },
      { id: "blank", locationRaw: null },
    ]);

    await run(path);

    expect(countries(path)).toEqual({ nowhere: null, blank: null });
  });

  it("writes nothing on a dry run", async () => {
    const path = makeDb([{ id: "sf", locationRaw: "sf" }]);

    await run(path, { dryRun: true });

    expect(countries(path)).toEqual({ sf: null });
  });
});

describe("relocate regions", () => {
  it("fills a blank region from the location and the stored city", async () => {
    const path = makeDb([
      { id: "austin", locationRaw: "Austin, TX", country: "US", city: "Austin" },
      { id: "blr", locationRaw: "Bengaluru, Karnataka, India", country: "IN", city: "Bengaluru" },
      // No division in the string — the city table supplies it.
      { id: "mpk", locationRaw: "Menlo Park", country: "US", city: "Menlo Park" },
    ]);

    await run(path);

    expect(regions(path)).toEqual({ austin: "TX", blr: "Karnataka", mpk: "CA" });
  });

  it("derives a region against a country the extractor supplied", async () => {
    // The row's own country and city are used, not a re-parse of its location:
    // re-parsing "Cupertino Office" finds no country, but the stored US does.
    const path = makeDb([
      { id: "hq", locationRaw: "Cupertino Office", country: "US", city: "Cupertino" },
    ]);

    await run(path);

    expect(regions(path)).toEqual({ hq: "CA" });
    expect(countries(path)).toEqual({ hq: "US" });
  });

  it("never overwrites a region already stored", async () => {
    const path = makeDb([
      { id: "pinned", locationRaw: "Austin, TX", country: "US", city: "Austin", region: "XX" },
    ]);

    await run(path);

    expect(regions(path)).toEqual({ pinned: "XX" });
  });

  it("fills country and region together in one pass", async () => {
    const path = makeDb([{ id: "sf", locationRaw: "San Francisco, CA" }]);

    await run(path);

    expect(countries(path)).toEqual({ sf: "US" });
    expect(regions(path)).toEqual({ sf: "CA" });
  });

  it("leaves the region blank where no division can be read", async () => {
    const path = makeDb([
      { id: "de", locationRaw: "Munich, BY, Germany", country: "DE", city: "Munich" },
      { id: "gb", locationRaw: "London, United Kingdom", country: "GB", city: "London" },
    ]);

    await run(path);

    expect(regions(path)).toEqual({ de: null, gb: null });
  });
});
