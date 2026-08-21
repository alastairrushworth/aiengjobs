import { openDb } from "./db/index.ts";
import { parseLocation } from "./pipeline/location.ts";
import { inferRegion } from "./pipeline/region.ts";

/**
 * One-off, inference-free backfill of `country` and `region` onto postings that
 * have neither — run once after changing the country hints in
 * pipeline/location.ts or the division tables in pipeline/region.ts. The nightly
 * ingest skips content-unchanged postings, so a rule added today never reaches a
 * row ingested last month without this.
 *
 * Neither field is cosmetic. Country is the one field Google requires of a
 * JobPosting's location, in both the TELECOMMUTE and the on-site shape, so a row
 * without one publishes no structured data at all (see shared/indexable.ts).
 * Region is recommended rather than required, and was missing from every address
 * the site had ever published, because nothing wrote the column.
 *
 * **Fills blanks only, and never overwrites.** Re-parsing every row is the
 * obvious implementation and it is wrong: until it was retired, the LLM
 * extractor backfilled country and city wherever the feed was silent, and those
 * values are not reproducible from location_raw. On the 2,733 currently-listed
 * postings a blanket re-parse would blank 43 good countries — "Chengdu" → CN,
 * "Almaty, Kazakhstan" → KZ, "Quito, Ecuador" → EC — costing more markup than
 * the pass recovers. Only NULLs are touched.
 *
 * Those same extractor-supplied values are an asset here: a region is derived
 * against whatever country and city the row already holds, so a posting the LLM
 * placed in California gets its state even though re-parsing its location would
 * find neither.
 */
export function relocate(opts: { dryRun?: boolean } = {}): void {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT id, location_raw AS locationRaw, country, region, city
       FROM jobs
       WHERE location_raw IS NOT NULL AND (country IS NULL OR region IS NULL)`,
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
  const byCountry = new Map<string, number>();
  let countries = 0;
  let regions = 0;

  for (const r of rows) {
    // Only the country and the region are read. The remote/hybrid/on-site
    // verdict parseLocation also returns is left alone — this pass is not
    // licensed to move roles between the board's work-type filters.
    const parsed = parseLocation(r.locationRaw);
    const country = r.country ?? parsed.country;
    if (!r.country && country) {
      if (!opts.dryRun) setCountry.run(country, r.id);
      byCountry.set(country, (byCountry.get(country) ?? 0) + 1);
      countries++;
    }
    if (!r.region) {
      const region = inferRegion(r.locationRaw, country, r.city ?? parsed.city);
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
      `${countries} countries${breakdown ? ` (${breakdown})` : ""} and ` +
      `${regions} regions across ${rows.length} incomplete postings`,
  );
}
