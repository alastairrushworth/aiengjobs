import type { Job } from "@aiengjobs/shared";
import { countryName, roleType, salaryMidpointUsd, SENIORITY_OPTIONS } from "./format.ts";
import { fxRates, generatedAt } from "./data.ts";
import { SENIOR_PLUS_IDS, SINCE_OPTIONS, WORK_OPTIONS } from "./search.ts";

/**
 * Option lists for the filter bar, counted against whatever set of roles the
 * page is actually offering to filter.
 *
 * The homepage passes the whole board; a landing passes its own roles, so
 * "United Kingdom (170)" on /ai-agent-jobs means 170 agent roles rather than
 * 170 roles site-wide. A count that describes a different set than the filter
 * acts on is worse than no count at all.
 */

export interface FilterOptions {
  roles: { label: string; count: number }[];
  countries: { code: string; label: string; count: number }[];
  cities: { name: string; count: number }[];
  seniorities: { id: string; label: string; count: number }[];
  /** Roles at or above `senior` — the grouped option (see search.SENIOR_PLUS). */
  seniorPlus: number;
  works: { id: string; label: string; count: number }[];
  sinces: { id: string; label: string; count: number }[];
  /** Roles that publish a usable pay range. */
  paid: number;
}

/**
 * Roles a city needs before it earns a row in the select.
 *
 * Lower than landings.MIN_CITY_JOBS, which guards a whole indexable page
 * against being thin — a select option carries no such cost, and 232 cities
 * appear across the board. Below this a city is still reachable by typing it:
 * the city is part of the search blob (see lib/search.searchBlob).
 */
export const MIN_CITY_OPTION = 5;

export function buildFilterOptions(jobs: Job[]): FilterOptions {
  // Role-type options, most common first, catch-all "Other" pinned last.
  const roleCounts = new Map<string, number>();
  for (const j of jobs) {
    const r = roleType(j);
    roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }
  const roles = [...roleCounts.entries()]
    .sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : b[1] - a[1]))
    .map(([label, count]) => ({ label, count }));

  const countryCounts = new Map<string, number>();
  for (const j of jobs) {
    if (j.country) countryCounts.set(j.country, (countryCounts.get(j.country) ?? 0) + 1);
  }
  const countries = [...countryCounts.entries()]
    // Feeds occasionally carry a literal "NULL" (and other non-ISO junk) in the
    // country column. countryName() passes those straight through, so they'd
    // otherwise appear verbatim as a filter option that means nothing to anyone.
    .filter(([code]) => /^[A-Za-z]{2}$/.test(code))
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, label: countryName(code) ?? code, count }));

  // Cities are already canonicalized on read (see lib/data), so "New York",
  // "New York City" and "New York Office" are one option rather than three.
  // Count order, like countries: the head is most of the board (the top 20
  // cities carry about half of it), so the useful rows sit at the top.
  const cityCounts = new Map<string, number>();
  for (const j of jobs) {
    if (j.city) cityCounts.set(j.city, (cityCounts.get(j.city) ?? 0) + 1);
  }
  const cities = [...cityCounts.entries()]
    .filter(([, count]) => count >= MIN_CITY_OPTION)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  const seniorities = SENIORITY_OPTIONS.map((s) => ({
    ...s,
    count: jobs.filter((j) => j.seniority === s.id).length,
  })).filter((s) => s.count > 0);
  const seniorPlus = jobs.filter(
    (j) => j.seniority && SENIOR_PLUS_IDS.includes(j.seniority),
  ).length;

  const works = WORK_OPTIONS.map((w) => ({
    ...w,
    count: jobs.filter((j) => j.remoteType === w.id).length,
  })).filter((w) => w.count > 0);

  // Freshness measured against the snapshot, exactly as the client does it —
  // the payload ships whole days since posting (JobEntry.ag) off this same
  // clock, so the number on the button is the number of cards you get.
  const genMs = Date.parse(generatedAt);
  const DAY_MS = 86_400_000;
  const sinces = SINCE_OPTIONS.map((o) => ({
    id: o.id,
    label: o.label,
    count: jobs.filter((j) => {
      const posted = j.postedAt ? Date.parse(j.postedAt) : NaN;
      return Number.isFinite(posted) && (genMs - posted) / DAY_MS <= o.days;
    }).length,
  })).filter((o) => o.count > 0);

  // Same gate as the card, the sort that used to exist and the stats page: a
  // role is priced everywhere or nowhere (see format.salaryMidpointUsd).
  const paid = jobs.filter((j) => salaryMidpointUsd(j, fxRates) !== null).length;

  return { roles, countries, cities, seniorities, seniorPlus, works, sinces, paid };
}
