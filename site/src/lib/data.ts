import snapshot from "../data/snapshot.json";
import type { SiteSnapshot, Job } from "@aiengjobs/shared";
import {
  MAX_JOB_AGE_DAYS,
  canonicalByDupKey,
  duplicateOfIn,
  jobAgeDays,
  listedJobs,
  withCanonicalCity,
} from "@aiengjobs/shared/indexable";

// The single place the untyped snapshot JSON crosses into typed code, with a
// cheap shape assertion so a malformed nightly export fails the build loudly
// instead of type-lying its way through every page.
const data = snapshot as unknown as SiteSnapshot;
if (!data || !Array.isArray(data.jobs) || !Array.isArray(data.companies) || !data.generatedAt) {
  throw new Error("snapshot.json has an unexpected shape — refusing to build");
}

// Staleness guard: if the nightly refresh dies, every freshness signal decays
// together ("Updated" date, sitemap lastmod, JobPosting validThrough, "posted
// Xd ago") and ghost jobs accumulate on a "no ghost jobs" board. Warn early,
// fail loudly once the snapshot is clearly dead. Deliberate rebuilds of an old
// snapshot can set ALLOW_STALE_SNAPSHOT=1.
const snapshotAgeDays = (Date.now() - Date.parse(data.generatedAt)) / 86_400_000;
if (snapshotAgeDays > 5 && !process.env.ALLOW_STALE_SNAPSHOT) {
  throw new Error(
    `snapshot.json is ${Math.floor(snapshotAgeDays)} days old — the nightly refresh ` +
      `loop is probably broken. Check the refresh workflow (or set ALLOW_STALE_SNAPSHOT=1 ` +
      `to build anyway).`,
  );
}
if (snapshotAgeDays > 2) {
  console.warn(
    `[data] snapshot.json is ${snapshotAgeDays.toFixed(1)} days old — check the nightly refresh loop.`,
  );
}

export const generatedAt: string = data.generatedAt;
export const fxRates: Record<string, number> = data.fxRates ?? {};
export const companies = data.companies;

/**
 * Companies by slug. Every job page needs its employer's row, and looking that
 * up with `companies.find` ran a linear scan of ~700 rows per page across ~6,100
 * pages — the sort of thing that is free until it suddenly isn't.
 */
export const companyBySlug: ReadonlyMap<string, (typeof companies)[number]> = new Map(
  data.companies.map((c) => [c.slug, c]),
);

const postedTs = (j: Job): number => (j.postedAt ? Date.parse(j.postedAt) || 0 : 0);

/**
 * Roles stop being listed once they pass this age, even though the ATS still
 * carries them and the nightly run still re-verifies them.
 *
 * "No ghost jobs" doesn't survive a board where a third of the inventory is a
 * quarter old: a requisition nobody has refreshed in three months is rarely a
 * live opportunity, and applying to one is the exact experience the board
 * exists to avoid. Every feed supplies postedAt, so this is measured, not
 * guessed. Aged-out roles fall out of the listings, the sitemap and the feeds
 * together, and their pages tombstone into the copy that already explains it.
 *
 * Defined in shared/indexable.ts, because crossing this line also strips the
 * JobPosting markup — which the engine has to know about before it submits a
 * URL to Google's Indexing API. Re-exported here so the site's many callers
 * keep importing it from the module that owns the listings.
 */
export { MAX_JOB_AGE_DAYS };

const ageDays = (j: Job): number | null => jobAgeDays(j, data.generatedAt);

/** Open roles, newest first (roles without a posted date sink to the bottom). */
export const openJobs: Job[] = listedJobs(data);

/** Recently-closed roles — rendered as noindexed tombstone pages, not listed. */
export const closedJobs: Job[] = data.jobs.filter((j) => j.isClosed).map(withCanonicalCity);

/**
 * How long a role that aged out of the listings keeps a tombstone before its
 * URL is allowed to 404.
 *
 * Mirrors the engine's CLOSED_RETENTION_DAYS (exportSnapshot.ts): a closed role
 * gets 30 days of tombstone so links from search results, newsletters and
 * shares land somewhere useful. A role that crossed MAX_JOB_AGE_DAYS is in the
 * same position — it was listed, indexed and shared right up until the refresh
 * that dropped it — but it used to 404 immediately, which is the one exit from
 * the board that got no landing at all. 2,051 URLs were in that state.
 *
 * Bounded rather than open-ended for the same reason the engine bounds closed
 * roles: two thirds of the aged-out set is 180+ days old and long gone from any
 * index, so building pages for it is cost without a reader.
 */
export const AGED_OUT_TOMBSTONE_DAYS = 30;

/**
 * Roles still open at the ATS that have passed MAX_JOB_AGE_DAYS, within the
 * tombstone window. Unlike closed roles these keep their description and their
 * apply link — the requisition is still live, it just stopped being something
 * this board is willing to vouch for.
 */
export const agedOutJobs: Job[] = data.jobs
  .filter((j) => !j.isClosed)
  .filter((j) => {
    const age = ageDays(j);
    return (
      age !== null &&
      age > MAX_JOB_AGE_DAYS &&
      age <= MAX_JOB_AGE_DAYS + AGED_OUT_TOMBSTONE_DAYS
    );
  })
  .map(withCanonicalCity)
  .sort((a, b) => postedTs(b) - postedTs(a));

// Employers routinely open several ATS requisitions for one role at one site
// (6x "Forward Deployed Engineer · Workato · Hyderabad" today). Each is a
// distinct posting with its own apply URL, but they render byte-identical
// pages, so we nominate the newest as canonical. The rest stay live and
// applicable — they just point their canonical at it, skip the JobPosting
// markup and stay out of the sitemap, so Google consolidates them deliberately
// instead of picking one arbitrarily and calling the others duplicate content.
//
// The keying itself lives in shared/indexable.ts: losing to a duplicate strips
// a page's JobPosting markup, so the engine has to reach the same verdict
// before it submits anything to Google's Indexing API.
const canonicalByKey = canonicalByDupKey(openJobs);

/** The slug of the posting this one duplicates, or null when it's canonical. */
export function duplicateOf(job: Job): string | null {
  return duplicateOfIn(canonicalByKey, job);
}
