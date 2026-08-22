import { openDb } from "./db/index.ts";
import { canonicalCity } from "@aiengjobs/shared/city";
import { parseLocation } from "./pipeline/location.ts";
import { inferRegion } from "./pipeline/region.ts";

/**
 * One-off, inference-free backfill of `country`, `region` and `city` onto
 * postings missing them — run once after changing the country hints in
 * pipeline/location.ts, the division tables in pipeline/region.ts, or the
 * canonicalization rules in shared/city.ts. The nightly ingest skips
 * content-unchanged postings, so a rule added today never reaches a row
 * ingested last month without this.
 *
 * None of the three is cosmetic. Country is the one field Google requires of a
 * JobPosting's location, in both the TELECOMMUTE and the on-site shape, so a row
 * without one publishes no structured data at all (see shared/indexable.ts).
 * Region is recommended rather than required, and was missing from every address
 * the site had ever published, because nothing wrote the column. City is the
 * addressLocality, and it also keys the location landing pages.
 *
 * **Fills blanks, and overwrites only what the current rules reject.**
 * Re-parsing every row is the obvious implementation and it is wrong: until it
 * was retired, the LLM extractor backfilled country and city wherever the feed
 * was silent, and those values are not reproducible from location_raw. On the
 * 2,733 currently-listed postings a blanket re-parse would blank 43 good
 * countries — "Chengdu" → CN, "Almaty, Kazakhstan" → KZ, "Quito, Ecuador" → EC
 * — costing more markup than the pass recovers.
 *
 * Country and region are therefore NULL-only. City has one extra case, and it
 * is narrow: a stored city that `canonicalCity` no longer accepts. That is a
 * value the current rules would never have written, so replacing it cannot
 * discard a good extractor answer — "Chengdu" canonicalizes to itself and is
 * untouched, while "Cn", "Va", "Ontario" and "N" (all of them live
 * addressLocality values, from "CN - Shanghai", "VA - Reston, 11951 Freedom Dr",
 * "Ontario, CAN" and "N/A") are not.
 *
 * Those same extractor-supplied values are an asset here: a region is derived
 * against whatever country and city the row already holds, so a posting the LLM
 * placed in California gets its state even though re-parsing its location would
 * find neither.
 */
export function relocate(opts: { dryRun?: boolean } = {}): void {
  const db = openDb();
  // Every located row, not just the incomplete ones: whether a stored city is
  // still acceptable is a question only canonicalCity can answer, and SQL
  // cannot ask it.
  const rows = db
    .prepare(
      `SELECT id, location_raw AS locationRaw, country, region, city
       FROM jobs
       WHERE location_raw IS NOT NULL`,
    )
    .all() as unknown as {
    id: string;
    locationRaw: string;
    country: string | null;
    region: string | null;
    city: string | null;
  }[];

  const setCountry = db.prepare(`UPDATE jobs SET country = ? WHERE id = ? AND country IS NULL`);
  const setRegion = db.prepare(`UPDATE jobs SET region = ? WHERE id = ? AND region IS NULL`);
  const setCity = db.prepare(`UPDATE jobs SET city = ? WHERE id = ?`);
  const byCountry = new Map<string, number>();
  let countries = 0;
  let regions = 0;
  let citiesFilled = 0;
  let citiesRepaired = 0;
  let citiesCleared = 0;

  for (const r of rows) {
    // Only the country, region and city are read. The remote/hybrid/on-site
    // verdict parseLocation also returns is left alone — this pass is not
    // licensed to move roles between the board's work-type filters.
    const parsed = parseLocation(r.locationRaw);
    const country = r.country ?? parsed.country;
    if (!r.country && country) {
      if (!opts.dryRun) setCountry.run(country, r.id);
      byCountry.set(country, (byCountry.get(country) ?? 0) + 1);
      countries++;
    }

    // Re-derive from location_raw first — it is the source of truth and
    // recovers a real place ("VA - Reston, 11951 Freedom Dr" → Reston) where
    // re-canonicalizing the stored code could only ever discard one. Falling
    // back to the re-canonicalized stored value keeps the cases where the raw
    // string is the thing the alias table fixed ("TLV" → Tel Aviv).
    const recanonicalized = canonicalCity(r.city);
    const city = parsed.city ?? recanonicalized ?? null;
    if (r.city === null) {
      if (city) {
        if (!opts.dryRun) setCity.run(city, r.id);
        citiesFilled++;
      }
    } else if (recanonicalized !== r.city) {
      if (!opts.dryRun) setCity.run(city, r.id);
      if (city) citiesRepaired++;
      else citiesCleared++;
    }

    if (!r.region) {
      const region = inferRegion(r.locationRaw, country, city ?? undefined);
      if (region) {
        if (!opts.dryRun) setRegion.run(region, r.id);
        regions++;
      }
    }
  }

  db.close();
  const breakdown = [...byCountry]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}=${n}`)
    .join(" ");
  console.log(
    `Relocate ${opts.dryRun ? "(dry run) would fill" : "complete. filled"} ` +
      `${countries} countries${breakdown ? ` (${breakdown})` : ""}, ` +
      `${regions} regions and ${citiesFilled} cities; ` +
      `repaired ${citiesRepaired} and cleared ${citiesCleared} cities the current ` +
      `rules reject, across ${rows.length} located postings`,
  );
}
