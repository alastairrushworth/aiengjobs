import snapshot from "../data/snapshot.json";
import type { SiteSnapshot, Job } from "@aiengjobs/shared";
import { canonicalCity } from "@aiengjobs/shared/city";

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
      `loop is probably broken. Fix the droplet job (or set ALLOW_STALE_SNAPSHOT=1 ` +
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

const postedTs = (j: Job): number => (j.postedAt ? Date.parse(j.postedAt) || 0 : 0);

// The snapshot is produced by whatever engine version last ran on the droplet,
// so the site canonicalizes city names on read rather than trusting the file.
// Without this the site is one nightly export behind its own rules — enough to
// split /ai-jobs-bangalore from /ai-jobs-bengaluru and to publish a junk
// addressLocality in the JobPosting markup. canonicalCity is idempotent, so a
// snapshot that's already clean passes through untouched.
const withCanonicalCity = (j: Job): Job => {
  const city = canonicalCity(j.city);
  return city === j.city ? j : { ...j, city };
};

/**
 * Roles stop being listed once they pass this age, even though the ATS still
 * carries them and the nightly run still re-verifies them.
 *
 * "No ghost jobs" doesn't survive a board where a third of the inventory is a
 * quarter old: a requisition nobody has refreshed in three months is rarely a
 * live opportunity, and applying to one is the exact experience the board
 * exists to avoid. Every feed supplies postedAt, so this is measured, not
 * guessed. Aged-out roles fall out of the listings, the sitemap and the feeds
 * together, and their pages 404 into the copy that already explains it.
 */
export const MAX_JOB_AGE_DAYS = 90;

const ageDays = (j: Job): number | null => {
  const posted = j.postedAt ? Date.parse(j.postedAt) : NaN;
  if (!Number.isFinite(posted)) return null;
  return (Date.parse(data.generatedAt) - posted) / 86_400_000;
};

/** Open roles, newest first (roles without a posted date sink to the bottom). */
export const openJobs: Job[] = data.jobs
  .filter((j) => !j.isClosed)
  // An unknown posting date can't be shown as fresh on a board that sells
  // freshness. No feed currently omits it, so this excludes nothing today.
  .filter((j) => {
    const age = ageDays(j);
    return age !== null && age <= MAX_JOB_AGE_DAYS;
  })
  .map(withCanonicalCity)
  .sort((a, b) => postedTs(b) - postedTs(a));

/** Recently-closed roles — rendered as noindexed tombstone pages, not listed. */
export const closedJobs: Job[] = data.jobs.filter((j) => j.isClosed).map(withCanonicalCity);

// Employers routinely open several ATS requisitions for one role at one site
// (6x "Forward Deployed Engineer · Workato · Hyderabad" today). Each is a
// distinct posting with its own apply URL, but they render byte-identical
// pages, so we nominate the newest as canonical. The rest stay live and
// applicable — they just point their canonical at it, skip the JobPosting
// markup and stay out of the sitemap, so Google consolidates them deliberately
// instead of picking one arbitrarily and calling the others duplicate content.
const dupKey = (j: Job) => [j.title, j.companySlug, j.locationRaw ?? ""].join(" ");
const canonicalByKey = new Map<string, string>();
for (const j of openJobs) {
  // openJobs is newest-first, so the first slug seen for a key is the newest.
  if (!canonicalByKey.has(dupKey(j))) canonicalByKey.set(dupKey(j), j.slug);
}

/** The slug of the posting this one duplicates, or null when it's canonical. */
export function duplicateOf(job: Job): string | null {
  const canonical = canonicalByKey.get(dupKey(job));
  return canonical && canonical !== job.slug ? canonical : null;
}
