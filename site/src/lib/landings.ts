import type { Job } from "@aiengjobs/shared";
import { citySlug } from "@aiengjobs/shared/city";
import { canonicalByDupKey, duplicateOfIn } from "@aiengjobs/shared/indexable";
import { CLUSTER_PAGES } from "./clusters.ts";
import { cityPlaces } from "./cityPlaces.ts";
import { countryName } from "./format.ts";
import { closedJobs, uniqueOpenJobs } from "./data.ts";

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
  jobs: uniqueOpenJobs.filter((j) => j.clusters.includes(p.id)),
}));

const remoteJobs = uniqueOpenJobs.filter((j) => j.remoteType === "remote");

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
// have to land on one page or every count here is understated), split by
// country only where the name is genuinely shared (lib/cityPlaces).
function buildCityLandings(reserved: Set<string>): Landing[] {
  // Roles closed within the engine's retention window — the evidence that a
  // city below MIN_CITY_JOBS was above it recently (see RETAIN_CITY_JOBS).
  // Folded like the listings: a closed requisition whose twin is still open,
  // or that duplicated another closed one, was never a separate card, so it is
  // no evidence the page was bigger.
  const dupKeys = canonicalByDupKey([...uniqueOpenJobs, ...closedJobs]);
  const recentlyClosed = closedJobs.filter((j) => duplicateOfIn(dupKeys, j) === null);

  const landings: Landing[] = [];
  for (const place of cityPlaces(uniqueOpenJobs, recentlyClosed)) {
    const { city, country, jobs } = place;
    const recentFootprint = jobs.length + place.recentlyClosed;
    const publishes = jobs.length >= MIN_CITY_JOBS;
    const retains = jobs.length >= RETAIN_CITY_JOBS && recentFootprint >= MIN_CITY_JOBS;
    if (!publishes && !retains) continue;
    const slug = citySlug(city);
    if (!slug) continue;

    // Name the country that owns the page. Every city page names it in the
    // intro and the stats block ("roles in London, United Kingdom"); a city
    // whose name is shared names it in the heading and the nav label too, or
    // two pages would carry the same h1 and the same link text.
    const named = country ? (countryName(country) ?? country) : null;
    const where = named ? `${city}, ${named}` : city;
    const heading = place.shared ? where : city;

    landings.push({
      slug: place.twin ? `ai-jobs-${slug}-${citySlug(named!)}` : `ai-jobs-${slug}`,
      kind: "city",
      label: heading,
      h1: `AI engineer jobs in ${heading}`,
      intro:
        `AI engineering roles in ${where} — LLM apps, RAG, agents, evals and inference. ` +
        `Pulled from company career sites, never scraped aggregators.`,
      where,
      jobs,
    });
  }

  // Biggest first — this order drives the browse nav. Then first claim wins a
  // slug: "ai-jobs-<city>-<country>" is built from feed text and could one day
  // spell an existing page's slug, and two landings on one route would have
  // the build pick between them silently.
  return landings
    .sort((a, b) => b.jobs.length - a.jobs.length)
    .filter((l) => {
      if (reserved.has(l.slug)) {
        console.warn(`[landings] slug ${l.slug} is already taken — skipping the ${l.where} page`);
        return false;
      }
      reserved.add(l.slug);
      return true;
    });
}

/**
 * Roles per listing-page slice. /ai-agent-jobs used to render all 1,110 cards
 * into one 652KB document with ~15k DOM nodes; slicing keeps every page light on
 * the phones most of this traffic arrives on, while still giving each role a
 * crawlable in-site link (previously the sitemap was doing that alone).
 *
 * Only [topic]/[...page].astro paginates on this now. The sitemap used to
 * derive a page count from it to list every slice; slices past the first are
 * noindexed today (components/LandingPage.astro), so it lists page 1 alone.
 */
export const PAGE_SIZE = 50;

export const CITY_LANDINGS: Landing[] = buildCityLandings(
  new Set([...clusterLandings, ...remoteLanding].map((l) => l.slug)),
);
export const LOCATION_LANDINGS: Landing[] = [...remoteLanding, ...CITY_LANDINGS];
export const LANDINGS: Landing[] = [...clusterLandings, ...LOCATION_LANDINGS];

export const landingBySlug = new Map(LANDINGS.map((l) => [l.slug, l]));
