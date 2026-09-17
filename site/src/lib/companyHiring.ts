import type { BoardHiring, Company, Job } from "@aiengjobs/shared";
import { CLUSTER_PAGES } from "./clusters.ts";
import { countryName, median, salaryMidpointUsd, salaryRangeUsd, SENIORITY_OPTIONS } from "./format.ts";

/**
 * What an employer's hiring looks like from the outside.
 *
 * An employer's careers page lists its roles. It does not say that a fifth of
 * them are AI engineering, that five were posted this month, that most publish
 * pay, or that the ones it filled were open for four months — because those are
 * facts about the set, and about time, and a careers page has neither view. The
 * board has both: every role in scope here, plus what the engine's database
 * knows about the rest (Company.hiring). This is the company page's reason to
 * exist beyond being a filtered list, and the one paragraph on a job page that
 * is about the employer rather than by them.
 *
 * Pure, like lib/payBenchmark: it is handed its roles, so it can be tested.
 */

/** Priced roles a company needs before a median is quoted for it. */
export const MIN_PRICED_FOR_COMPANY_MEDIAN = 3;

/** "Recently posted" on a board whose listing window is 90 days. */
export const RECENT_DAYS = 30;

export interface Tally {
  label: string;
  count: number;
  /** Landing page for the entry, when the board has one. */
  slug?: string;
}

export interface CompanyHiringSummary {
  /** Roles listed on the board. */
  openRoles: number;
  /** Of those, posted within RECENT_DAYS. */
  postedRecently: number;
  pricedCount: number;
  /** Median USD midpoint; null below MIN_PRICED_FOR_COMPANY_MEDIAN. */
  medianUsd: number | null;
  /** Lowest floor to highest ceiling across the priced roles. */
  payRangeUsd: { lo: number; hi: number } | null;
  remoteCount: number;
  locations: Tally[];
  levels: Tally[];
  clusters: Tally[];
  /** Every open posting on the employer's board in the listing window. */
  openPostings?: number;
  /** openRoles / openPostings — how much of its hiring is in this board's scope. */
  scopeShare?: number;
  closedRoles?: number;
  medianDaysOpen?: number;
  /** The same median across every employer, for comparison. */
  boardMedianDaysOpen?: number;
}

const DAY_MS = 86_400_000;

const top = (m: Map<string, number>, n: number): { label: string; count: number }[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));

const bump = (m: Map<string, number>, k: string | undefined | null) => {
  if (k) m.set(k, (m.get(k) ?? 0) + 1);
};

export function summarizeCompanyHiring(
  jobs: Job[],
  company: Pick<Company, "hiring"> | undefined,
  board: BoardHiring | undefined,
  generatedAt: string,
  fxRates: Record<string, number>,
): CompanyHiringSummary {
  const now = Date.parse(generatedAt);
  const mids: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  const locations = new Map<string, number>();
  const levels = new Map<string, number>();
  const clusters = new Map<string, number>();
  let postedRecently = 0;
  let remoteCount = 0;

  for (const j of jobs) {
    const mid = salaryMidpointUsd(j, fxRates);
    const range = salaryRangeUsd(j, fxRates);
    if (mid !== null && range) {
      mids.push(mid);
      lo = Math.min(lo, range.lo);
      hi = Math.max(hi, range.hi);
    }
    const posted = j.postedAt ? Date.parse(j.postedAt) : NaN;
    if (Number.isFinite(posted) && (now - posted) / DAY_MS <= RECENT_DAYS) postedRecently++;
    if (j.remoteType === "remote") remoteCount++;
    // A remote role's "location" is wherever the applicant is; counting its
    // nominal city would put a hub on the map that nobody has to work in.
    else bump(locations, j.city ?? countryName(j.country));
    bump(levels, j.seniority);
    for (const c of j.clusters) bump(clusters, c);
  }

  const levelLabel = new Map(SENIORITY_OPTIONS.map((o) => [o.id as string, o.label]));
  const clusterPage = new Map(CLUSTER_PAGES.map((p) => [p.id as string, p]));

  const openPostings = company?.hiring?.openPostings;
  // Guarded rather than trusted: the two counts come from different processes
  // (the engine's database, the site's listing rules) and a share above 100%
  // is the kind of number that gets screenshotted.
  const scopeShare =
    openPostings !== undefined && openPostings >= jobs.length && openPostings > 0
      ? jobs.length / openPostings
      : undefined;

  return {
    openRoles: jobs.length,
    postedRecently,
    pricedCount: mids.length,
    medianUsd: mids.length >= MIN_PRICED_FOR_COMPANY_MEDIAN ? median(mids) : null,
    payRangeUsd: mids.length > 0 ? { lo, hi } : null,
    remoteCount,
    locations: top(locations, 4),
    // Ladder order, not frequency: "2 Senior · 5 Staff" reads as a shape.
    levels: SENIORITY_OPTIONS.filter((o) => levels.has(o.id)).map((o) => ({
      label: levelLabel.get(o.id)!,
      count: levels.get(o.id)!,
    })),
    clusters: top(clusters, 4)
      .filter((c) => clusterPage.has(c.label))
      .map((c) => ({
        label: clusterPage.get(c.label)!.label,
        slug: clusterPage.get(c.label)!.slug,
        count: c.count,
      })),
    ...(scopeShare !== undefined ? { openPostings, scopeShare } : {}),
    ...(company?.hiring ? { closedRoles: company.hiring.closedRoles } : {}),
    ...(company?.hiring?.medianDaysOpen !== undefined
      ? { medianDaysOpen: company.hiring.medianDaysOpen }
      : {}),
    ...(board?.medianDaysOpen !== undefined ? { boardMedianDaysOpen: board.medianDaysOpen } : {}),
  };
}

/** "21%", but never "0%" for a share that is merely small. */
export function sharePct(share: number): string {
  const pct = share * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}
