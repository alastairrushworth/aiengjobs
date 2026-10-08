import { fxRates, uniqueOpenJobs } from "./data.ts";
import { median, salaryMidpointUsd } from "./format.ts";

/**
 * Board-wide figures a landing sets its own against (lib/landingStats,
 * LandingContext). Computed once: every landing slice renders the stats
 * block's inputs, and the board is a few thousand roles.
 */

const mids = uniqueOpenJobs
  .map((j) => salaryMidpointUsd(j, fxRates))
  .filter((m): m is number => m !== null);

/** Median USD midpoint across every priced open role; null below five. */
export const BOARD_MEDIAN_USD: number | null = mids.length >= 5 ? median(mids) : null;

/** Open roles per ISO country code, duplicates folded. */
export const OPEN_BY_COUNTRY: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const j of uniqueOpenJobs) if (j.country) m.set(j.country, (m.get(j.country) ?? 0) + 1);
  return m;
})();
