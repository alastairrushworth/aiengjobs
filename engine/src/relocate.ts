import { openDb } from "./db/index.ts";
import { parseLocation } from "./pipeline/location.ts";

/**
 * One-off, inference-free backfill of `country` onto postings that have none —
 * run once after changing the country hints in pipeline/location.ts. The
 * nightly ingest skips content-unchanged postings, so a hint added today never
 * reaches a row ingested last month without this.
 *
 * Country is not cosmetic: it is the one field Google requires of a
 * JobPosting's location, in both the TELECOMMUTE and the on-site shape, so a
 * row without one publishes no structured data at all (see
 * shared/indexable.ts). Search Console found 53 such rows the hard way.
 *
 * **Fills blanks only, and never overwrites.** Re-parsing every row is the
 * obvious implementation and it is wrong: until it was retired, the LLM
 * extractor backfilled country wherever the feed was silent, and those values
 * are not reproducible from location_raw. On the 2,714 currently-listed
 * postings a blanket re-parse would blank 43 good countries — "Chengdu" → CN,
 * "Almaty, Kazakhstan" → KZ, "Quito, Ecuador" → EC — costing more markup than
 * the pass recovers. Only NULLs are touched.
 */
export function relocate(opts: { dryRun?: boolean } = {}): void {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT id, location_raw AS locationRaw
       FROM jobs WHERE country IS NULL AND location_raw IS NOT NULL`,
    )
    .all() as unknown as { id: string; locationRaw: string }[];

  const update = db.prepare(`UPDATE jobs SET country = ? WHERE id = ? AND country IS NULL`);
  const byCountry = new Map<string, number>();
  let filled = 0;

  for (const r of rows) {
    // Only the country is read. The remote/hybrid/on-site verdict parseLocation
    // also returns is left alone — this pass is not licensed to move roles
    // between the board's work-type filters.
    const { country } = parseLocation(r.locationRaw);
    if (!country) continue;
    if (!opts.dryRun) update.run(country, r.id);
    byCountry.set(country, (byCountry.get(country) ?? 0) + 1);
    filled++;
  }

  db.close();
  const breakdown = [...byCountry]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}=${n}`)
    .join(" ");
  console.log(
    `Relocate ${opts.dryRun ? "(dry run) would fill" : "complete. filled"} ` +
      `${filled}/${rows.length} countryless postings${breakdown ? ` — ${breakdown}` : ""}`,
  );
}
