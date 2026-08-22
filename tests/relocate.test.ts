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

function read(path: string, column: "country" | "region" | "city"): Record<string, string | null> {
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
const cities = (path: string): Record<string, string | null> => read(path, "city");

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

describe("relocate cities", () => {
  it("fills a blank city from the current canonicalization rules", async () => {
    const path = makeDb([
      { id: "hq", locationRaw: "*HQ - San Francisco, CA" },
      { id: "sfo", locationRaw: "SF Office" },
      { id: "hybrid", locationRaw: "Hybrid London" },
    ]);

    await run(path);

    expect(cities(path)).toEqual({
      hq: "San Francisco",
      sfo: "San Francisco",
      hybrid: "London",
    });
  });

  /**
   * The stored values this exists for. Each was a live addressLocality: a
   * country or state code that an older engine left behind when it could not
   * strip it, because the code was the whole value.
   */
  it("repairs a stored city the current rules reject", async () => {
    const path = makeDb([
      { id: "cn", locationRaw: "CN - Shanghai", city: "Cn" },
      { id: "va", locationRaw: "VA - Reston, 11951 Freedom Dr Ste 900", city: "Va" },
      { id: "sg", locationRaw: "SG - Singapore", city: "Sg" },
      { id: "tlv", locationRaw: "TLV", city: "Tlv" },
    ]);

    await run(path);

    expect(cities(path)).toEqual({
      cn: "Shanghai",
      va: "Reston",
      sg: "Singapore",
      tlv: "Tel Aviv",
    });
  });

  it("clears a rejected city when the raw location yields no replacement", async () => {
    // A role keeps its country either way, so it still publishes a JobPosting —
    // it just stops claiming a locality that was never one.
    const path = makeDb([
      { id: "prov", locationRaw: "Ontario, CAN", city: "Ontario" },
      { id: "na", locationRaw: "N/A", city: "N" },
    ]);

    await run(path);

    expect(cities(path)).toEqual({ prov: null, na: null });
  });

  /**
   * The guard that makes the pass safe to run. The retired LLM extractor filled
   * cities that location_raw does not contain, and those are not reproducible —
   * blanking them would cost more markup than the pass recovers.
   */
  it("never touches a stored city the current rules still accept", async () => {
    const path = makeDb([
      // Nothing in either raw string yields a city, but both stored values are
      // canonical, so both survive untouched.
      { id: "llm", locationRaw: "Remote", city: "Chengdu" },
      { id: "ulm", locationRaw: "Ulm, BW, Germany", city: "Ulm" },
    ]);

    await run(path);

    expect(cities(path)).toEqual({ llm: "Chengdu", ulm: "Ulm" });
  });

  it("writes no city on a dry run", async () => {
    const path = makeDb([{ id: "cn", locationRaw: "CN - Shanghai", city: "Cn" }]);

    await run(path, { dryRun: true });

    expect(cities(path)).toEqual({ cn: "Cn" });
  });

  it("is idempotent — a second pass changes nothing", async () => {
    const path = makeDb([
      { id: "cn", locationRaw: "CN - Shanghai", city: "Cn" },
      { id: "hq", locationRaw: "*HQ - San Francisco, CA" },
      { id: "prov", locationRaw: "Ontario, CAN", city: "Ontario" },
    ]);

    await run(path);
    const first = cities(path);
    await run(path);

    expect(cities(path)).toEqual(first);
  });
});
