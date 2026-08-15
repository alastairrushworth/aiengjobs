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

// Base.astro appends " — frontierroles.com" (20 chars), so budget for the whole
// thing. Keep these two in step: a longer brand eats the role's room, and the
// pair has to stay under the ~70 chars Google renders before truncating.
const TITLE_BUDGET = 50;
const MIN_ROLE_CHARS = 24;

/**
 * Backstop on role + suffix, brand excluded.
 *
 * Deliberately loose. Two leaks pushed 395 indexable titles past the ~70
 * characters Google renders, 11 past 120, and one to 203: an unbounded suffix
 * (fixed by MAX_PLACE_CHARS) and an unbounded collision allowance (fixed by
 * ending the NEXT_ALLOWANCE ladder at a finite rung). This catches whatever
 * those two miss.
 *
 * It is NOT set to TITLE_BUDGET, which was the first thing tried. Doing that
 * caps the role name at the budget *before* the collision loop has run, which
 * is the one thing this file exists to prevent — it re-merged the two Anduril
 * "Staff Robotics Software Engineer, Air Vehicle …" roles under one title. A
 * long title beats two distinct jobs sharing one, so the ceiling has to sit
 * above what disambiguation actually costs (~74 characters on this corpus).
 *
 * Enforced by trimming the role name, never the suffix: the company is what
 * makes a result identifiable in a SERP.
 */
const MAX_TITLE_CHARS = 110;

/**
 * Ceiling on the place half of the suffix. `locationRaw` is the last-resort
 * candidate and arrives unbounded — "Mountain View, CALIFORNIA, United States"
 * is 40 characters on its own, which left 129-character titles once the
 * company was added.
 *
 * Trimming can in principle make two postings that differ only in the tail of
 * their location render the same title. That is the case the comment in
 * `suffixOf` already describes and accepts: such pages stay distinct by URL,
 * and one of the set is normally a `duplicateOf` canonical anyway.
 */
const MAX_PLACE_CHARS = 18;

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

  // Increasingly specific ways to say where a role is. The suffix picks the
  // first that actually tells this posting apart from the others it collides
  // with, rather than the first that happens to be non-null.
  //
  // `j.city ?? countryName(...)` short-circuited on the city, and two postings
  // can share one: two Coalition roles both carrying the city "Any location"
  // (one US, one Canada) rendered an identical <title> AND meta description,
  // and two Anduril "Research Scientist, Battlespace Awareness" roles both sit
  // in Broomfield with different full location strings. The collision loop
  // below can't rescue either — it only grows the role-name allowance, and the
  // role names are already the same.
  const placeCandidates = (j: Job): string[] => [
    ...new Set(
      [
        j.city ?? undefined,
        [j.city, countryName(j.country)].filter(Boolean).join(", ") || undefined,
        j.locationRaw ?? undefined,
      ].filter((s): s is string => Boolean(s)),
    ),
  ];

  const trimPlace = (where: string) => truncateRole(where, MAX_PLACE_CHARS);

  // For each candidate string, how many colliding postings would still share
  // it — counted for the full string and for its trimmed form, because the two
  // don't always agree. "Any location, United States" and "Any location,
  // Canada" are distinct at full length and identical once trimmed, so
  // trimming unconditionally would undo the disambiguation this map exists to
  // provide (it did, and the Coalition regression test caught it).
  const placeCount = new Map<string, number>();
  const trimmedCount = new Map<string, number>();
  for (const j of jobs) {
    const candidates = placeCandidates(j);
    for (const where of candidates) {
      const k = `${j.title}·${j.companyName}·${where}`;
      placeCount.set(k, (placeCount.get(k) ?? 0) + 1);
    }
    // Deduped per posting, because the two maps are compared against each other
    // below and have to count the same thing: postings, not candidate slots.
    // "Mountain View, United States" and "Mountain View, CALIFORNIA, United
    // States" are two candidates of one job that trim to one string, so
    // counting them separately made every trimmed form look twice as shared as
    // it was and the comparison never trimmed anything.
    for (const t of new Set(candidates.map(trimPlace))) {
      const k = `${j.title}·${j.companyName}·${t}`;
      trimmedCount.set(k, (trimmedCount.get(k) ?? 0) + 1);
    }
  }

  const suffixOf = (j: Job) => {
    const dup = (titleCount.get(`${j.title}·${j.companyName}`) ?? 0) > 1;
    let where: string | undefined;
    if (dup) {
      const candidates = placeCandidates(j);
      const chosen =
        candidates.find(
          (c) => (placeCount.get(`${j.title}·${j.companyName}·${c}`) ?? 0) === 1,
        ) ??
        // Nothing separates them — two requisitions genuinely alike in every
        // field we render. Use the most specific string anyway; the pages stay
        // distinct by URL and one of them is usually a `duplicateOf` canonical.
        candidates[candidates.length - 1];
      // Trim only where it costs nothing: if the trimmed form is shared by more
      // postings than the full one was, the characters it saved were the ones
      // telling two pages apart.
      if (chosen) {
        const trimmed = trimPlace(chosen);
        const full = placeCount.get(`${j.title}·${j.companyName}·${chosen}`) ?? 0;
        const short = trimmedCount.get(`${j.title}·${j.companyName}·${trimmed}`) ?? 0;
        where = short <= full ? trimmed : chosen;
      }
    }
    return [j.companyName, where]
      .filter(Boolean)
      .map((s) => ` · ${s}`)
      .join("");
  };

  const suffixes = new Map(jobs.map((j) => [j.slug, suffixOf(j)]));

  // Extra characters granted to a role name beyond the budget. Escalates only
  // for titles that collide, and stops at the last rung.
  //
  // That rung used to be Infinity — "give up and use the full title" — which is
  // how one <title> reached 203 characters off a 163-character feed title. The
  // reasoning for it still holds ("anything still colliding at full length is a
  // genuine duplicate requisition, which data.ts canonicalizes onto one page
  // anyway"), and that is exactly why the rung can be finite: the pages it
  // gives up on are the ones already consolidated onto a canonical, so the
  // collision it permits is between a page and a page Google has been told to
  // ignore. 56 covers every real disambiguation on this corpus, which needs
  // ~24.
  const NEXT_ALLOWANCE = new Map<number, number>([
    [0, 24],
    [24, 56],
  ]);
  const allowance = new Map(jobs.map((j) => [j.slug, 0]));

  const render = () => {
    const titles = new Map<string, string>();
    for (const j of jobs) {
      const suffix = suffixes.get(j.slug)!;
      const room = Math.max(MIN_ROLE_CHARS, TITLE_BUDGET - suffix.length) + allowance.get(j.slug)!;
      // The allowance below can reach Infinity, so the ceiling is applied here
      // rather than trusted to the budget. MIN_ROLE_CHARS still wins over it:
      // a role name cut to nothing names no job, and an unusually long company
      // is the one case where overshooting MAX_TITLE_CHARS beats that.
      const capped = Math.max(MIN_ROLE_CHARS, Math.min(room, MAX_TITLE_CHARS - suffix.length));
      titles.set(j.slug, `${truncateRole(j.title, capped)}${suffix}`);
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
