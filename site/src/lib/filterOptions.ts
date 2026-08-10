import type { Job } from "@aiengjobs/shared";
import { countryName, SENIORITY_OPTIONS } from "./format.ts";
import { SENIOR_PLUS_IDS, WORK_OPTIONS } from "./search.ts";

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
  countries: { code: string; label: string; count: number }[];
  cities: { name: string; count: number }[];
  seniorities: { id: string; label: string; count: number }[];
  /** Roles at or above `senior` — the grouped option (see search.SENIOR_PLUS). */
  seniorPlus: number;
  works: { id: string; label: string; count: number }[];
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
  // Alphabetical, unlike countries: this list runs to ~90 rows, and someone
  // opening it has a city in mind — scanning for a known name is what the
  // ordering has to serve, not ranking the board by size.
  const cityCounts = new Map<string, number>();
  for (const j of jobs) {
    if (j.city) cityCounts.set(j.city, (cityCounts.get(j.city) ?? 0) + 1);
  }
  const cities = [...cityCounts.entries()]
    .filter(([, count]) => count >= MIN_CITY_OPTION)
    .sort((a, b) => a[0].localeCompare(b[0]))
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

  return { countries, cities, seniorities, seniorPlus, works };
}
