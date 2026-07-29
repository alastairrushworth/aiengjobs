import type { Job } from "@aiengjobs/shared";
import { citySlug } from "@aiengjobs/shared/city";
import { CLUSTER_PAGES } from "./clusters.ts";
import { countryName } from "./format.ts";
import { openJobs } from "./data.ts";

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
  /** Fills "…roles in {where}" / "{where} salaries" copy. */
  where: string;
  jobs: Job[];
}

/**
 * A location page only earns its place once it has enough roles to be worth
 * landing on. Below this it's a thin near-duplicate of the homepage, which
 * costs more in site-wide quality signals than the long tail can pay back.
 */
export const MIN_CITY_JOBS = 12;

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

  const landings: Landing[] = [];
  for (const [city, jobs] of byCity) {
    if (jobs.length < MIN_CITY_JOBS) continue;
    const slug = citySlug(city);
    if (!slug) continue;

    // Some city names are genuinely shared across countries (Cambridge,
    // Birmingham). Name the countries in the copy rather than silently merging
    // them or inventing a country-qualified URL nobody searches for.
    const countries = [...new Set(jobs.map((j) => j.country).filter(Boolean))] as string[];
    const named = countries.map((c) => countryName(c) ?? c);
    const where =
      named.length === 1 ? `${city}, ${named[0]}` : city;
    const scope =
      named.length > 1
        ? ` Covers ${city} in ${named.slice(0, 3).join(", ")}.`
        : "";

    landings.push({
      slug: `ai-jobs-${slug}`,
      kind: "city",
      label: city,
      h1: `AI engineer jobs in ${city}`,
      intro:
        `AI engineering roles in ${where} — LLM apps, RAG, agents, evals and inference. ` +
        `Pulled from company career sites, never scraped aggregators.${scope}`,
      where,
      jobs,
    });
  }

  // Biggest first — this order drives the browse nav.
  return landings.sort((a, b) => b.jobs.length - a.jobs.length);
}

export const CITY_LANDINGS: Landing[] = buildCityLandings();
export const LOCATION_LANDINGS: Landing[] = [...remoteLanding, ...CITY_LANDINGS];
export const LANDINGS: Landing[] = [...clusterLandings, ...LOCATION_LANDINGS];

export const landingBySlug = new Map(LANDINGS.map((l) => [l.slug, l]));
