import type { Job } from "@aiengjobs/shared";
import { citySlug } from "@aiengjobs/shared/city";
import { CLUSTER_PAGES } from "./clusters.ts";
import { countryName } from "./format.ts";
import { closedJobs, openJobs } from "./data.ts";

/**
 * Every top-level listing page the board publishes: the stack-native cluster
 * pages plus location pages (per city, and remote).
 *
 * Clusters and locations share one route and one template — they differ only in
 * which roles they select and what the copy says — so pagination, the stats
 * block and the feeds are written once and apply to all of them.
 */
export interface Landing {
  slug: string;
  kind: "cluster" | "city" | "remote";
  /** Short label for nav links. */
  label: string;
  h1: string;
  intro: string;
  /** Fills "…roles in {where}" / "Hiring snapshot for {where}" copy. */
  where: string;
  jobs: Job[];
}

/**
 * A location page only earns its place once it has enough roles to be worth
 * landing on. Below this it's a thin near-duplicate of the homepage, which
 * costs more in site-wide quality signals than the long tail can pay back.
 */
export const MIN_CITY_JOBS = 12;

/**
 * Once published, a city page survives down to this many open roles.
 *
 * A single threshold makes the published set flap. Six of the 34 city landings
 * sit within three roles of the line today and two (McLean, Pune) sit exactly
 * on it, so one closed requisition retires a page Google has already indexed —
 * then the next hire brings it back. Each round trip spends crawl budget and
 * throws away whatever the URL had accumulated, for a page whose content barely
 * changed.
 *
 * Hysteresis needs to know the page existed before, and a static build has no
 * memory of the last one. The closed roles in the snapshot are that memory:
 * the engine retains them for 30 days (CLOSED_RETENTION_DAYS), so a city whose
 * open + recently-closed count clears MIN_CITY_JOBS demonstrably *was* above
 * the line inside that window. A city genuinely shrinking runs out of recent
 * closures and retires properly once it drops under this floor.
 */
export const RETAIN_CITY_JOBS = 9;

const clusterLandings: Landing[] = CLUSTER_PAGES.map((p) => ({
  slug: p.slug,
  kind: "cluster",
  label: p.label,
  h1: p.h1,
  intro: p.intro,
  where: p.label,
  jobs: openJobs.filter((j) => j.clusters.includes(p.id)),
}));

const remoteJobs = openJobs.filter((j) => j.remoteType === "remote");

const remoteLanding: Landing[] = remoteJobs.length >= MIN_CITY_JOBS
  ? [
      {
        slug: "remote-ai-jobs",
        kind: "remote",
        label: "Remote",
        h1: "Remote AI engineer jobs",
        intro:
          "Fully-remote AI engineering roles — RAG, agents, evals, inference and fine-tuning — taken straight from company ATS feeds.",
        where: "remote roles",
        jobs: remoteJobs,
      },
    ]
  : [];

// City pages, built from the canonicalized city names in the snapshot (see
// @aiengjobs/shared/city — "New York City", "NYC" and "New York Office" all
// have to land on one page or every count here is understated).
function buildCityLandings(): Landing[] {
  const byCity = new Map<string, Job[]>();
  for (const j of openJobs) {
    if (!j.city) continue;
    const list = byCity.get(j.city);
    if (list) list.push(j);
    else byCity.set(j.city, [j]);
  }

  // Roles closed within the engine's retention window, per city — the evidence
  // that a city below MIN_CITY_JOBS was above it recently (see RETAIN_CITY_JOBS).
  const recentlyClosedByCity = new Map<string, number>();
  for (const j of closedJobs) {
    if (!j.city) continue;
    recentlyClosedByCity.set(j.city, (recentlyClosedByCity.get(j.city) ?? 0) + 1);
  }

  const landings: Landing[] = [];
  for (const [city, jobs] of byCity) {
    const recentFootprint = jobs.length + (recentlyClosedByCity.get(city) ?? 0);
    const publishes = jobs.length >= MIN_CITY_JOBS;
    const retains = jobs.length >= RETAIN_CITY_JOBS && recentFootprint >= MIN_CITY_JOBS;
    if (!publishes && !retains) continue;
    const slug = citySlug(city);
    if (!slug) continue;

    // Name the country that owns the page and stop there.
    //
    // This used to list every country present, to disambiguate genuinely shared
    // city names (Cambridge, Birmingham). That intent is sound but no such city
    // clears MIN_CITY_JOBS, so in practice the clause only ever surfaced
    // upstream mislabels: "Covers San Francisco in United States, Netherlands"
    // off one stray role in 600, London picking up the United States off 5 in
    // 223, and Berlin and Sydney both acquiring the United Kingdom. A share
    // threshold cut the worst of it but couldn't separate a real split from a
    // bad country code, because the difference isn't in the numbers.
    //
    // The dominant country is accurate for the overwhelming majority of roles
    // on every one of these pages and is what a reader actually needs. If a
    // genuine 60/40 city ever grows large enough to earn a landing, this is
    // where the disambiguation goes back — and the real fix for the strays is
    // in the location pipeline, not in this copy.
    const countryCounts = new Map<string, number>();
    for (const j of jobs) {
      if (j.country) countryCounts.set(j.country, (countryCounts.get(j.country) ?? 0) + 1);
    }
    const dominant = [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const named = dominant ? (countryName(dominant) ?? dominant) : null;
    const where = named ? `${city}, ${named}` : city;

    landings.push({
      slug: `ai-jobs-${slug}`,
      kind: "city",
      label: city,
      h1: `AI engineer jobs in ${city}`,
      intro:
        `AI engineering roles in ${where} — LLM apps, RAG, agents, evals and inference. ` +
        `Pulled from company career sites, never scraped aggregators.`,
      where,
      jobs,
    });
  }

  // Biggest first — this order drives the browse nav.
  return landings.sort((a, b) => b.jobs.length - a.jobs.length);
}

/**
 * Roles per listing-page slice. /ai-agent-jobs used to render all 1,110 cards
 * into one 652KB document with ~15k DOM nodes; slicing keeps every page light on
 * the phones most of this traffic arrives on, while still giving each role a
 * crawlable in-site link (previously the sitemap was doing that alone).
 *
 * Shared by [topic]/[...page].astro and the sitemap so the two can't disagree
 * about how many pages exist.
 */
export const PAGE_SIZE = 50;

/** Number of slices a landing paginates into (always at least 1). */
export const pageCount = (l: Landing): number =>
  Math.max(1, Math.ceil(l.jobs.length / PAGE_SIZE));

export const CITY_LANDINGS: Landing[] = buildCityLandings();
export const LOCATION_LANDINGS: Landing[] = [...remoteLanding, ...CITY_LANDINGS];
export const LANDINGS: Landing[] = [...clusterLandings, ...LOCATION_LANDINGS];

export const landingBySlug = new Map(LANDINGS.map((l) => [l.slug, l]));
