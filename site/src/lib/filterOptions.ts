import type { Job } from "@aiengjobs/shared";
import { countryName, roleType, SENIORITY_OPTIONS } from "./format.ts";

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
  seniorities: { id: string; label: string; count: number }[];
}

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

  const seniorities = SENIORITY_OPTIONS.map((s) => ({
    ...s,
    count: jobs.filter((j) => j.seniority === s.id).length,
  })).filter((s) => s.count > 0);

  return { roles, countries, seniorities };
}
