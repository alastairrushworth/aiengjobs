import type { Job } from "@aiengjobs/shared";

/**
 * Which city pages the open roles make, before any size threshold: one per
 * city name, or one per country where the name is genuinely shared.
 *
 * Pure — handed its roles, like lib/payBenchmark — so the rule can be tested
 * against hand-built cases; lib/landings binds it to the snapshot and decides
 * which of these clear MIN_CITY_JOBS.
 */

/**
 * Employers a country's roles in a city have to come from — counting only
 * postings that name a single site — before that country is taken to be a real
 * home of the city name rather than a mislabel.
 *
 * Grouping by city name alone put Cambridge, MA and Cambridge, UK on one page:
 * on 2026-10-08 /ai-jobs-cambridge/ held 17 US roles, 6 GB and 1 with no
 * country, under copy and a stats block that called all of it "Cambridge,
 * United States" and a median salary that blended the two markets. The page
 * used to name only its dominant country because the one earlier attempt at
 * disambiguation — listing every country present — only ever surfaced
 * mislabels ("Covers San Francisco in United States, Netherlands" off one
 * stray role in 600), and no genuinely shared name cleared MIN_CITY_JOBS.
 * Cambridge now does.
 *
 * Every other city with more than one country present is still the mislabel
 * case: a role filed under the right city with somebody else's country code.
 * Share can't tell the two apart. Across every row of the 2026-10-08 snapshot
 * (open, closed, aged-out and delisted), Amsterdam carries 28 GB roles out of
 * 78 — 36%, more than Cambridge's 25% — and Hong Kong 9 SG out of 27; nor can
 * employer count alone, since those Amsterdam roles come from three employers.
 * What does separate them is where the stray country comes from. Every one of
 * those 28 is a multi-site posting ("Amsterdam, Netherlands; …; London, United
 * Kingdom") whose city came from one site and its country from another, and
 * so are London's 23 US roles, Berlin's 12 GB/US and Munich's 2 GB. Of the
 * minority-country roles that name one site, Cambridge has 13 from five
 * employers (Speechmatics, Graphcore, Darktrace, AVEVA, Luminance); no other
 * city has more than one, from one employer — "Dublin, Ireland (Mountain
 * View)" filed as US, "Hong Kong, Singapore" as SG. Hyderabad's 8 US roles
 * are all one employer's ATS default, which this floor would catch even if its
 * "Hyderabad - <building>" format didn't read as multi-site.
 *
 * So a country counts as a real home of a city name when its single-site
 * postings there come from at least this many employers, counted across open
 * roles and the closed ones the engine retains (the same 30-day memory
 * lib/landings' RETAIN_CITY_JOBS leans on, so the verdict doesn't flap with one
 * requisition). A mislabel is one employer's location format repeated across
 * its requisitions; a real place is independent employers each saying so.
 * Two real homes split the city; the real fix for the mislabels is in the
 * location pipeline, and until then they stay on their city's page, which is
 * where the role actually is.
 *
 * The same evidence picks which country owns the page, ahead of the plurality.
 * Hong Kong is the case: 3 HK and 3 SG open roles today, so the plurality was
 * a coin toss, and had it landed on SG the five employers posting a single-site
 * "Hong Kong" would have read as a twin city and split off.
 */
export const MIN_PLACE_EMPLOYERS = 2;

/**
 * A location string listing more than one site. Deliberately broad: a
 * single-site posting misread as multi-site only withholds evidence, and a
 * city with no evidenced home falls back to its plurality country — the old
 * behaviour, which leaves the city whole. The reverse error is the dangerous
 * one: it would let one employer's multi-office posting vouch for a country.
 * On 2026-10-08 only Cambridge has two evidenced homes; Hong Kong is the only
 * city whose owner differs from its plurality; and 161 cities, five of them
 * with nine or more roles (Pangyo, Geneva, Mississauga, Costa Mesa, Tampa),
 * have no evidenced home at all and keep the plurality.
 */
const MULTI_SITE = /;| & | and | or |\||\/| - |\n/i;

/** The most common known country among these roles, if any has one. */
function dominantCountry(jobs: Job[]): string | undefined {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    if (j.country) counts.set(j.country, (counts.get(j.country) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Roles bucketed by key, in input order; a null key leaves the role out. */
const groupBy = (jobs: Job[], key: (j: Job) => string | null) => {
  const m = new Map<string, Job[]>();
  for (const j of jobs) {
    const k = key(j);
    if (k === null) continue;
    const list = m.get(k);
    if (list) list.push(j);
    else m.set(k, [j]);
  }
  return m;
};

export interface CityPlace {
  city: string;
  /** ISO country the page is about; undefined when no role in the city has one. */
  country: string | undefined;
  /** A second country sharing the name, off the city's bare slug. */
  twin: boolean;
  /** The name is shared with another country here, so the copy has to say which. */
  shared: boolean;
  jobs: Job[];
  /** Roles closed within the retention window that belong to this page. */
  recentlyClosed: number;
}

/**
 * @param open Listed roles, newest first, duplicates already folded.
 * @param closed Roles closed within the engine's retention window, likewise.
 */
export function cityPlaces(open: Job[], closed: Job[]): CityPlace[] {
  const openByCity = groupBy(open, (j) => j.city || null);
  const closedByCity = groupBy(closed, (j) => j.city || null);
  const places: CityPlace[] = [];

  for (const [city, cityOpen] of openByCity) {
    const cityClosed = closedByCity.get(city) ?? [];

    // Countries with independent single-site evidence (MIN_PLACE_EMPLOYERS).
    const employersByCountry = new Map<string, Set<string>>();
    for (const j of [...cityOpen, ...cityClosed]) {
      if (!j.country || MULTI_SITE.test(j.locationRaw ?? "")) continue;
      const set = employersByCountry.get(j.country) ?? new Set<string>();
      set.add(j.companySlug);
      employersByCountry.set(j.country, set);
    }
    const homes = [...employersByCountry]
      .filter(([, e]) => e.size >= MIN_PLACE_EMPLOYERS)
      .map(([c]) => c);

    // The country that owns the page: the evidenced home with the most open
    // roles, or — for a city too small or too multi-site to evidence any — the
    // plurality, as before. lib/landings gives it the bare /ai-jobs-<city>/
    // slug, so a URL Google has indexed doesn't move when a twin is recognised
    // beside it.
    const openCount = (c: string) => cityOpen.filter((j) => j.country === c).length;
    const owner = homes.length
      ? homes.sort((a, b) => openCount(b) - openCount(a))[0]
      : dominantCountry(cityOpen);
    const twins = new Set(homes.filter((c) => c !== owner));

    // Which page a role belongs on. Once a twin is recognised, every role
    // carrying its country goes with it, multi-site or not — the evidence was
    // about the place, and a Cambridge role labelled GB is then in Cambridge,
    // GB. A stray of any *other* country stays with the owner's page: it is
    // almost certainly a real role in this city with a bad code, and dropping
    // it would hide it from the one page it belongs on. A role with no country
    // at all stays too, unless the city is split — then it can't be placed on
    // either page, and listing it under a page that names a country would
    // claim something nobody knows.
    //
    // Closed roles are keyed the same way, so a twin's retention evidence is
    // its own and not the owner's.
    const OWNER = "";
    const pageOf = (j: Job): string | null => {
      if (j.country && twins.has(j.country)) return j.country;
      if (!j.country && twins.size > 0) return null;
      return OWNER;
    };
    const closedByPage = groupBy(cityClosed, pageOf);
    for (const [page, jobs] of groupBy(cityOpen, pageOf)) {
      places.push({
        city,
        country: page === OWNER ? owner : page,
        twin: page !== OWNER,
        shared: twins.size > 0,
        jobs,
        recentlyClosed: closedByPage.get(page)?.length ?? 0,
      });
    }
  }
  return places;
}
