import { jobAgeDays } from "@aiengjobs/shared/indexable";
import type { Job } from "@aiengjobs/shared";
import { LANDINGS } from "./landings.ts";
import { url } from "./url.ts";
import {
  uniqueOpenJobs,
  openJobsByCompany,
  companyPageIndexable,
  generatedAt,
} from "./data.ts";

/**
 * The sitemap, as two files behind one index.
 *
 * One flat file of ~4,000 URLs told Google nothing about which of them mattered,
 * and Search Console reported it as one number. Split, the ~500 hub pages — the
 * homepage, the landings, the directories, the employer pages — sit in a file of
 * their own that Google can read in one fetch and report on separately, and the
 * job pages, which turn over completely every quarter, sit in the other.
 *
 * `loc` is safe by construction — every URL goes through `new URL()`, which
 * percent-encodes anything XML would object to. `lastmod` is validated by
 * `day()` below, because `updatedAt` reaches here verbatim from the Ashby and
 * Greenhouse feeds and nothing else checks it; ten characters of `&` would make
 * the whole file ill-formed, and a sitemap that fails to parse takes every URL
 * in it down with it.
 */

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

/**
 * How recently a role must have been posted to be listed in the jobs sitemap.
 *
 * Every open role stays indexable and keeps its in-site links through the
 * landing slices; this only decides which ones the sitemap puts in front of
 * Google. A role's page is most worth a crawl in its first weeks — it is new
 * to Google, it is what the Indexing API announced, and a reader finding it
 * from Search still has time to apply — and a sitemap that names the whole
 * 90-day inventory with equal weight asks Google to spend its few hundred
 * daily fetches on the oldest third as readily as on last night's arrivals.
 * At 30 days the file carries ~2,300 of ~3,500 roles. Raise it back to
 * MAX_JOB_AGE_DAYS to list them all again.
 */
export const SITEMAP_JOB_MAX_AGE_DAYS = 30;

/** The date part of an ISO timestamp, and only if it really is one. */
export const day = (iso?: string): string | undefined => {
  const d = iso?.slice(0, 10);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
};

/**
 * Absolute, trailing-slash URL — the form GitHub Pages actually serves. The
 * slash-less form 301s, and a sitemap full of redirects wastes crawl budget.
 * The belt-and-braces guard on the result handles `url("/")` dropping the
 * base's trailing slash, and keeps working if `base` ever returns.
 */
export const abs = (site: URL | undefined, p: string): string => {
  const href = new URL(url(p.endsWith("/") ? p : `${p}/`), site).href;
  return href.endsWith("/") ? href : `${href}/`;
};

/**
 * When a listing page's list last changed: the newest arrival among the roles
 * it shows. The hubs used to carry the snapshot date, which moved every URL's
 * lastmod every night whether or not anything on the page had changed — 516
 * URLs stamped "today" on 2026-10-08 — and a lastmod that always moves is one
 * Google learns to ignore. Departures aren't dated in the snapshot, so a page
 * that only lost roles reads as unchanged; under-reporting is the safe side.
 */
const newestArrival = (jobs: Job[]): string | undefined => {
  let newest = "";
  for (const j of jobs) if (j.ingestedAt && j.ingestedAt > newest) newest = j.ingestedAt;
  return day(newest) ?? day(generatedAt);
};

/**
 * Every indexable page that is not a job: the pages that persist while the
 * roles on them turn over, and the ones the crawl should start from.
 */
export function hubEntries(site: URL | undefined): SitemapEntry[] {
  const entries: SitemapEntry[] = [
    // These change with every refresh — the newest cards, the counts, the
    // directory totals — so the snapshot date is their honest lastmod.
    { loc: abs(site, "/"), lastmod: day(generatedAt) },
    { loc: abs(site, "/stats"), lastmod: day(generatedAt) },
    { loc: abs(site, "/locations"), lastmod: day(generatedAt) },
    { loc: abs(site, "/companies"), lastmod: day(generatedAt) },
    // Static copy: no lastmod rather than a false one.
    { loc: abs(site, "/mcp") },
  ];
  // Page 1 of each landing only. Pages 2+ are noindexed
  // (components/LandingPage.astro says why), and a sitemap that lists a URL the
  // page itself asks Google to ignore is a contradictory signal.
  for (const landing of LANDINGS) {
    entries.push({ loc: abs(site, `/${landing.slug}`), lastmod: newestArrival(landing.jobs) });
  }
  // Company pages with enough roles to be more than one role's page again —
  // the same line the page draws for its own noindex (MIN_INDEXED_COMPANY_ROLES).
  // Page 1 only, as for the landings.
  for (const [slug, jobs] of openJobsByCompany) {
    if (!companyPageIndexable(slug)) continue;
    entries.push({ loc: abs(site, `/companies/${slug}`), lastmod: newestArrival(jobs) });
  }
  return entries;
}

/**
 * Open, canonical roles posted within SITEMAP_JOB_MAX_AGE_DAYS. Closed-job
 * tombstones are noindexed and deliberately absent, as are duplicate
 * requisitions — they canonicalize onto the newest of their set, and
 * submitting a URL we've told Google to ignore is a contradictory signal.
 */
export function jobEntries(site: URL | undefined): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const j of uniqueOpenJobs) {
    const age = jobAgeDays(j, generatedAt);
    if (age === null || age > SITEMAP_JOB_MAX_AGE_DAYS) continue;
    entries.push({
      loc: abs(site, `/jobs/${j.slug}`),
      lastmod: day(j.updatedAt ?? j.postedAt) ?? day(generatedAt),
    });
  }
  return entries;
}

/** The newest lastmod in a file — what its row in the index reports. */
export const newestLastmod = (entries: SitemapEntry[]): string | undefined =>
  entries.reduce<string | undefined>(
    (acc, e) => (e.lastmod && (!acc || e.lastmod > acc) ? e.lastmod : acc),
    undefined,
  );

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n`;
const NS = `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`;

export function urlset(entries: SitemapEntry[]): string {
  return (
    `${XML_HEAD}<urlset ${NS}>\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`
  );
}

export function sitemapIndex(children: SitemapEntry[]): string {
  return (
    `${XML_HEAD}<sitemapindex ${NS}>\n` +
    children
      .map(
        (e) =>
          `  <sitemap><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</sitemap>`,
      )
      .join("\n") +
    `\n</sitemapindex>\n`
  );
}

export const XML_HEADERS = { "Content-Type": "application/xml; charset=utf-8" };
