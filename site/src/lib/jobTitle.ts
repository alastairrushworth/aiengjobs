import type { Job } from "@aiengjobs/shared";
import { countryName } from "./format.ts";

/**
 * Build the `<title>` text for every job page in one pass.
 *
 * Two competing pressures:
 *
 * 1. Feed titles run long — a fifth of them past 100 characters, one past 200 —
 *    and Google renders about 60. The company (plus a disambiguating city when
 *    the same role posts at several sites) is what makes a result identifiable
 *    in a SERP, so that is kept whole and the role name absorbs the trimming.
 *    The page's <h1> still carries the employer's full title.
 *
 * 2. Trimming can make genuinely different roles collide — "Staff Robotics
 *    Software Engineer, Air Vehicle Autonomy" and "Staff Robotics Software
 *    Engineer, Perception" share a 58-character prefix. Two distinct jobs under
 *    one title is worse for search than one long title.
 *
 * So this runs over the whole corpus: trim to the budget, then grant more room
 * only to the titles that collided, repeatedly, until each is unambiguous —
 * paying the extra characters where they buy something rather than across the
 * board. Anything still colliding at full length is a genuine duplicate
 * requisition, which data.ts canonicalizes onto one page anyway.
 */

// Base.astro appends " — aiengjobs" (12 chars), so budget for the whole thing.
const TITLE_BUDGET = 58;
const MIN_ROLE_CHARS = 24;

function truncateRole(title: string, room: number): string {
  if (title.length <= room) return title;
  const cut = title.slice(0, room - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on a word boundary when it doesn't gut the title.
  const kept = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s·,\-–—:;(\[/]+$/, "")}…`;
}

export function buildJobTitles(jobs: Job[]): Map<string, string> {
  // Same title + company across several locations (common for multi-office
  // postings) would emit identical titles; those get the location appended.
  const titleCount = new Map<string, number>();
  for (const j of jobs) {
    const k = `${j.title}·${j.companyName}`;
    titleCount.set(k, (titleCount.get(k) ?? 0) + 1);
  }

  const suffixOf = (j: Job) => {
    const dup = (titleCount.get(`${j.title}·${j.companyName}`) ?? 0) > 1;
    const where = dup ? (j.city ?? countryName(j.country) ?? j.locationRaw) : null;
    return [j.companyName, where]
      .filter(Boolean)
      .map((s) => ` · ${s}`)
      .join("");
  };

  const suffixes = new Map(jobs.map((j) => [j.slug, suffixOf(j)]));

  // Extra characters granted to a role name beyond the budget. Escalates only
  // for titles that collide; Infinity means "give up and use the full title".
  const NEXT_ALLOWANCE = new Map<number, number>([
    [0, 24],
    [24, 56],
    [56, Infinity],
  ]);
  const allowance = new Map(jobs.map((j) => [j.slug, 0]));

  const render = () => {
    const titles = new Map<string, string>();
    for (const j of jobs) {
      const suffix = suffixes.get(j.slug)!;
      const room = Math.max(MIN_ROLE_CHARS, TITLE_BUDGET - suffix.length) + allowance.get(j.slug)!;
      titles.set(j.slug, `${truncateRole(j.title, room)}${suffix}`);
    }
    return titles;
  };

  let titles = render();
  for (;;) {
    // Which rendered titles cover more than one distinct employer title?
    const distinctSources = new Map<string, Set<string>>();
    for (const j of jobs) {
      const t = titles.get(j.slug)!;
      const set = distinctSources.get(t) ?? distinctSources.set(t, new Set()).get(t)!;
      set.add(j.title);
    }
    let grew = false;
    for (const j of jobs) {
      if (distinctSources.get(titles.get(j.slug)!)!.size < 2) continue;
      const next = NEXT_ALLOWANCE.get(allowance.get(j.slug)!);
      if (next === undefined) continue; // already at full length — a real duplicate
      allowance.set(j.slug, next);
      grew = true;
    }
    if (!grew) break;
    titles = render();
  }
  return titles;
}
