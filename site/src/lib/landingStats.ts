import type { Job } from "@aiengjobs/shared";
import { median, salaryMidpointUsd, SENIORITY_OPTIONS } from "./format.ts";

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
  /** The same median across the whole board, when the caller supplied it. */
  boardMedianUsd: number | null;
  remote: number;
  hybrid: number;
  onsite: number;
  /** Roles whose employer posted them within the last 7 / 30 days. */
  postedThisWeek: number;
  postedLast30: number;
  /** Seniority tally in ladder order, levels with no roles omitted. */
  levels: TopEntry[];
  /** For a city page: how much of its country's hiring it is. */
  countryShare: { name: string; total: number; pct: number } | null;
  topCompanies: TopEntry[];
  topSkills: TopEntry[];
  /** Newest posting date across the set, for "last updated" honesty. */
  newestPostedAt?: string;
}

/** What a landing's stats are measured against — the board, and its country. */
export interface LandingContext {
  /** Median USD midpoint across every priced role on the board. */
  boardMedianUsd?: number | null;
  /** The country a city page sits in, with its open-role total. */
  country?: { name: string; total: number };
}

const DAY_MS = 86_400_000;

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
 * This is what stops ~60 programmatic pages from being boilerplate: each one
 * carries its own salary distribution, hiring companies, stack, level mix and
 * posting pace, computed from the roles actually on it and set against the
 * board as a whole. Cheap to produce, and it's the part a reader (and a
 * quality rater) would actually find useful — and, unlike the job pages, the
 * landings don't expire, so what accrues to them stays.
 *
 * Ages are measured against `generatedAt`, the snapshot's own clock, so a
 * rebuild of an old snapshot says what was true then rather than drifting.
 */
export function computeLandingStats(
  jobs: Job[],
  fxRates: Record<string, number>,
  generatedAt: string,
  context: LandingContext = {},
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

  const genMs = Date.parse(generatedAt);
  const postedTimes = jobs
    .map((j) => (j.postedAt ? Date.parse(j.postedAt) : NaN))
    .filter((t) => Number.isFinite(t));
  const postedWithin = (days: number) =>
    Number.isFinite(genMs) ? postedTimes.filter((t) => genMs - t <= days * DAY_MS).length : 0;

  const levelCounts = tally(jobs, (j) => j.seniority);
  const levels = SENIORITY_OPTIONS.map(({ id, label }) => ({
    name: label,
    slug: id,
    count: levelCounts.get(id) ?? 0,
  })).filter((l) => l.count > 0);

  const total = jobs.length;
  const country = context.country;
  const countryShare =
    country && country.total > 0 && total < country.total
      ? { name: country.name, total: country.total, pct: Math.round((total / country.total) * 100) }
      : null;

  return {
    total,
    pricedCount: mids.length,
    medianUsd: mids.length >= 5 ? median(mids) : null, // too few to be meaningful
    boardMedianUsd: context.boardMedianUsd ?? null,
    remote: jobs.filter((j) => j.remoteType === "remote").length,
    hybrid: jobs.filter((j) => j.remoteType === "hybrid").length,
    onsite: jobs.filter((j) => j.remoteType === "onsite").length,
    postedThisWeek: postedWithin(7),
    postedLast30: postedWithin(30),
    levels,
    countryShare,
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
