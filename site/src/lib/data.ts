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
/** Board-wide closure statistics from the engine; absent on snapshots older than the field. */
export const boardHiring = data.hiring;

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

/**
 * Every open role, newest first (roles without a posted date sink to the
 * bottom) — duplicate requisitions included.
 *
 * This is the set that gets a /jobs/ page: a duplicate is still a live posting
 * with its own apply link, and its page canonicalizes onto the newest of its
 * set rather than disappearing. Anything that *lists* or *counts* roles wants
 * `uniqueOpenJobs` below instead.
 */
export const openJobs: Job[] = listedJobs(data);

/** Recently-closed roles — rendered as noindexed tombstone pages, not listed. */
export const closedJobs: Job[] = data.jobs.filter((j) => j.isClosed).map(withCanonicalCity);

/**
 * Roles the classifier ruled out of scope within the engine's retention window
 * — still open at the ATS, no longer listed here. The third tombstone kind:
 * like aged-out, the apply link still works; like closed, the description is
 * gone. Before the engine tracked these (jobs.delisted_at) they simply left
 * the snapshot, and 40 URLs Google had indexed went 404 in the fortnight
 * after the 2026-08-22 reclassification. Disjoint from closedJobs by
 * construction (the exporter never sets both flags).
 */
export const delistedJobs: Job[] = data.jobs
  .filter((j) => !j.isClosed && j.isDelisted)
  .map(withCanonicalCity);

// Employers routinely open several ATS requisitions for one role at one site
// (6x "Software Engineer · Cisco · Budapest" on 2026-10-08). Each is a
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

/**
 * Open roles with duplicate requisitions folded into their canonical posting,
 * newest first — the board as a reader sees it.
 *
 * Every listing, count and stat is built from this. The sitemap, the feeds,
 * the JobPosting markup, the MCP index and llms.txt all folded duplicates
 * already, while the homepage, /stats, the landings and the company pages
 * listed every requisition: "Browse 3616 roles" on the homepage against 3523
 * in llms.txt on 2026-10-08, and six identical "Software Engineer · Budapest"
 * cards on Cisco's page. Two counts of one board is one too many, and the
 * reader's is the deduplicated one — the six cards are one job.
 */
export const uniqueOpenJobs: Job[] = openJobs.filter((j) => duplicateOf(j) === null);

/**
 * Open roles per employer, in listing order, duplicates folded. Built once for
 * the company pages, the sitemap and the job pages' "More at" links. Its keys
 * are every employer with an open role — a duplicate's canonical is open at the
 * same employer, so folding can't empty an entry.
 */
export const openJobsByCompany: ReadonlyMap<string, Job[]> = (() => {
  const m = new Map<string, Job[]>();
  for (const j of uniqueOpenJobs) {
    const list = m.get(j.companySlug);
    if (list) list.push(j);
    else m.set(j.companySlug, [j]);
  }
  return m;
})();

/**
 * Open roles a company needs before its page is offered to search engines.
 *
 * A company page with one role is that role's page again with a different
 * heading — same card, same stack, one fewer paragraph — and 206 of the 661
 * company pages were exactly that on 2026-09-08. After Google's August 2026
 * spam update cut the board's impressions by ~93%, near-duplicate URLs are the
 * thing to have fewer of. The page still builds and still links (it is the
 * breadcrumb parent of its role, and the nav lands on it); it just carries
 * noindex and stays out of the sitemap until a second role arrives.
 */
export const MIN_INDEXED_COMPANY_ROLES = 2;

/** Does this company's page earn an index entry? Shared by the page and the sitemap. */
export const companyPageIndexable = (companySlug: string): boolean =>
  (openJobsByCompany.get(companySlug)?.length ?? 0) >= MIN_INDEXED_COMPANY_ROLES;

/**
 * How long a role that left the board keeps a tombstone page before its URL
 * is allowed to 404 — one window for all three exits (closed, delisted,
 * aged out).
 *
 * A tombstone exists for the reader who follows a stale link: a search
 * result, a newsletter, a share, an assistant's answer from the MCP server.
 * It used to last 30 days, matching the engine's CLOSED_RETENTION_DAYS, and
 * that produced ~3,100 noindexed pages against ~3,600 listed roles — nearly
 * half the site. Google kept re-crawling them (Search Console's noindex
 * examples on 2026-10-08 were all tombstones fetched that week) while 3,175
 * live pages sat "discovered, never crawled", and the Search traffic those
 * tombstones were built to catch amounted to 43 clicks in three months. A
 * week covers the stale-link case that actually happens; after that the 404
 * page, with its browse links, is the honest answer.
 *
 * The engine still retains closed rows for 30 days: lib/landings reads them
 * as the evidence that a city page was recently above MIN_CITY_JOBS. Only the
 * page-building window shrinks, hence closedAt/delistedAt on the snapshot.
 */
export const TOMBSTONE_DAYS = 7;

/**
 * Whether a closure or delisting is recent enough to still earn a page. The
 * date is absent on snapshots older than the field; an exit of unknown age
 * is treated as recent, so an old snapshot builds what it used to.
 */
const withinTombstoneWindow = (iso: string | undefined): boolean => {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return (Date.parse(data.generatedAt) - t) / 86_400_000 <= TOMBSTONE_DAYS;
};

/** The closed roles that still get a tombstone page (see TOMBSTONE_DAYS). */
export const closedTombstones: Job[] = closedJobs.filter((j) => withinTombstoneWindow(j.closedAt));

/** The delisted roles that still get a tombstone page (see TOMBSTONE_DAYS). */
export const delistedTombstones: Job[] = delistedJobs.filter((j) =>
  withinTombstoneWindow(j.delistedAt),
);

/**
 * Roles still open at the ATS that have passed MAX_JOB_AGE_DAYS, within the
 * tombstone window. Unlike closed roles these keep their description and their
 * apply link — the requisition is still live, it just stopped being something
 * this board is willing to vouch for.
 */
export const agedOutJobs: Job[] = data.jobs
  // Not delisted either: a role can be both, and it needs exactly one page.
  .filter((j) => !j.isClosed && !j.isDelisted)
  .filter((j) => {
    const age = ageDays(j);
    return (
      age !== null &&
      age > MAX_JOB_AGE_DAYS &&
      age <= MAX_JOB_AGE_DAYS + TOMBSTONE_DAYS
    );
  })
  .map(withCanonicalCity)
  .sort((a, b) => postedTs(b) - postedTs(a));
