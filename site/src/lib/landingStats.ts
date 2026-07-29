import type { Job } from "@aiengjobs/shared";
import { median, salaryMidpointUsd } from "./format.ts";

export interface TopEntry {
  name: string;
  slug?: string;
  count: number;
}

export interface LandingStats {
  total: number;
  /** Roles with a usable published range (any currency, annualized to USD). */
  pricedCount: number;
  medianUsd: number | null;
  remote: number;
  hybrid: number;
  onsite: number;
  topCompanies: TopEntry[];
  topSkills: TopEntry[];
  /** Newest posting date across the set, for "last updated" honesty. */
  newestPostedAt?: string;
}

function tally<T>(items: T[], key: (t: T) => string | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const topN = (m: Map<string, number>, n: number): TopEntry[] =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));

/**
 * Aggregate facts for a listing page.
 *
 * This is what stops ~50 programmatic pages from being boilerplate: each one
 * carries its own salary distribution, hiring companies and stack, computed from
 * the roles actually on it. Cheap to produce, and it's the part a reader (and a
 * quality rater) would actually find useful.
 */
export function computeLandingStats(
  jobs: Job[],
  fxRates: Record<string, number>,
): LandingStats {
  const mids = jobs
    .map((j) => salaryMidpointUsd(j, fxRates))
    .filter((m): m is number => m !== null);

  const companyCounts = tally(jobs, (j) => j.companyName);
  const companySlugs = new Map(jobs.map((j) => [j.companyName, j.companySlug]));

  const skillCounts = new Map<string, number>();
  for (const j of jobs) {
    for (const s of j.skills) skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
  }

  const postedTimes = jobs
    .map((j) => (j.postedAt ? Date.parse(j.postedAt) : NaN))
    .filter((t) => Number.isFinite(t));

  return {
    total: jobs.length,
    pricedCount: mids.length,
    medianUsd: mids.length >= 5 ? median(mids) : null, // too few to be meaningful
    remote: jobs.filter((j) => j.remoteType === "remote").length,
    hybrid: jobs.filter((j) => j.remoteType === "hybrid").length,
    onsite: jobs.filter((j) => j.remoteType === "onsite").length,
    topCompanies: topN(companyCounts, 6).map((e) => ({
      ...e,
      slug: companySlugs.get(e.name),
    })),
    topSkills: topN(skillCounts, 10),
    newestPostedAt: postedTimes.length
      ? new Date(Math.max(...postedTimes)).toISOString()
      : undefined,
  };
}
