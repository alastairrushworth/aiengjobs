import { openDb } from "./db/index.ts";
import { canonicalCity } from "@aiengjobs/shared/city";
import { firstSegmentCity, parseLocation, type LocationInfo } from "./pipeline/location.ts";
import { inferRegion } from "./pipeline/region.ts";

/**
 * Inference-free backfill of `country`, `region` and `city` onto postings
 * missing them, under the current country hints in pipeline/location.ts, the
 * division tables in pipeline/region.ts and the canonicalization rules in
 * shared/city.ts. Runs in the nightly refresh between ingest and export
 * (cli.ts): ingest skips content-unchanged postings, so a rule added today
 * would otherwise never reach a row ingested last month.
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
 * Country and region are therefore NULL-only. City has two extra cases, both
 * narrow. The first is a stored city that `canonicalCity` no longer accepts.
 * That is a value the current rules would never have written, so replacing it
 * cannot discard a good extractor answer — "Chengdu" canonicalizes to itself and is
 * untouched, while "Cn", "Va", "Ontario" and "N" (all of them live
 * addressLocality values, from "CN - Shanghai", "VA - Reston, 11951 Freedom Dr",
 * "Ontario, CAN" and "N/A") are not. The second is a stored city that is the
 * engine's own first-segment reading of a location the parser now reads broad
 * → narrow — "Washington" for "Washington - Bellevue" — see relocateRow.
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
    const next = relocateRow(parseLocation(r.locationRaw), r);
    if (next.country !== r.country) {
      if (!opts.dryRun) setCountry.run(next.country, r.id);
      byCountry.set(next.country!, (byCountry.get(next.country!) ?? 0) + 1);
      countries++;
    }
    if (next.city !== r.city) {
      if (!opts.dryRun) setCity.run(next.city, r.id);
      if (r.city === null) citiesFilled++;
      else if (next.city) citiesRepaired++;
      else citiesCleared++;
    }
    if (next.region !== r.region) {
      if (!opts.dryRun) setRegion.run(next.region, r.id);
      regions++;
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

interface Located {
  locationRaw: string;
  country: string | null;
  region: string | null;
  city: string | null;
}

/**
 * The country, region and city one stored row should hold under the current
 * rules — the decision `relocate` applies, separated from the SQL so it can be
 * measured against a snapshot without a database. See relocate for the rules.
 */
export function relocateRow(
  parsed: LocationInfo,
  r: Located,
): { country: string | null; region: string | null; city: string | null } {
  const country = r.country ?? parsed.country ?? null;

  // Re-derive from location_raw first — it is the source of truth and
  // recovers a real place ("VA - Reston, 11951 Freedom Dr" → Reston) where
  // re-canonicalizing the stored code could only ever discard one. Falling
  // back to the re-canonicalized stored value keeps the cases where the raw
  // string is the thing the alias table fixed ("TLV" → Tel Aviv).
  const recanonicalized = canonicalCity(r.city);
  const derived = parsed.city ?? recanonicalized ?? null;
  // The second narrow case: a stored city the current parser *reads past*.
  // "Washington - Bellevue" was stored as Washington because the first segment
  // was taken for the city; parseLocation now recognises the state in front
  // and answers Bellevue. Gated on the stored value being exactly what the
  // first-segment reading yields, so it can only ever replace the engine's own
  // mechanical answer, never a city the extractor supplied.
  const readPast =
    parsed.city !== undefined &&
    parsed.city !== r.city &&
    r.city === firstSegmentCity(r.locationRaw);
  const city = r.city === null || recanonicalized !== r.city || readPast ? derived : r.city;

  // parseLocation's own region when it agrees on country and city — it alone
  // knows the broad → narrow shape, where the division sits in front of the
  // city — and otherwise one derived against whatever the row holds.
  const ownRegion =
    parsed.country === (country ?? undefined) && parsed.city === (city ?? undefined)
      ? parsed.region
      : undefined;
  const region =
    r.region ??
    ownRegion ??
    inferRegion(r.locationRaw, country ?? undefined, city ?? undefined) ??
    null;
  return { country, region, city };
}
