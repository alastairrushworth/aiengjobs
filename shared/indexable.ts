import type { Job, SiteSnapshot } from "./types.ts";
import { canonicalCity } from "./city.ts";

/**
 * Which /jobs/<slug>/ URLs actually carry JobPosting markup.
 *
 * Three independent rules decide that, and the site applies them in three
 * different places: the age cutoff and duplicate consolidation in
 * site/src/lib/data.ts, and Google's insistence on a resolvable location in
 * jobs/[slug].astro. A page that fails any of them still exists and is still
 * applicable — it just renders without the structured data.
 *
 * The engine needs the same answer. Google licenses the Indexing API for
 * exactly two content types, JobPosting and BroadcastEvent, and submitting a
 * URL carrying neither is the documented way to get a project's access revoked.
 * Restating the rules engine-side would leave two copies one refactor away from
 * disagreeing — on a question where disagreeing is expensive — so they live
 * here and both sides import them.
 */

/**
 * Roles stop being listed once they pass this age, even though the ATS still
 * carries them and the nightly run still re-verifies them. Their pages become
 * tombstones, which is why the cutoff belongs to this module as much as to the
 * listings: crossing it removes the JobPosting markup.
 */
export const MAX_JOB_AGE_DAYS = 90;

/** Age in days at snapshot time, or null when the feed supplied no posted date. */
export function jobAgeDays(job: Job, generatedAt: string): number | null {
  const posted = job.postedAt ? Date.parse(job.postedAt) : NaN;
  if (!Number.isFinite(posted)) return null;
  return (Date.parse(generatedAt) - posted) / 86_400_000;
}

/**
 * The snapshot is produced by whatever engine version last ran nightly, so city
 * names are canonicalized on read rather than trusted — otherwise a consumer is
 * one nightly export behind its own rules. Idempotent, so a clean snapshot
 * passes through untouched.
 */
export function withCanonicalCity(job: Job): Job {
  const city = canonicalCity(job.city);
  return city === job.city ? job : { ...job, city };
}

const postedTs = (j: Job): number => (j.postedAt ? Date.parse(j.postedAt) || 0 : 0);

/**
 * Open roles inside the age window, newest first — the set the site lists.
 * Roles without a posted date sink to the bottom, and roles whose date is
 * missing entirely are excluded: a board that sells freshness can't show an
 * unknown date as fresh.
 */
export function listedJobs(snapshot: SiteSnapshot): Job[] {
  return snapshot.jobs
    .filter((j) => !j.isClosed)
    .filter((j) => {
      const age = jobAgeDays(j, snapshot.generatedAt);
      return age !== null && age <= MAX_JOB_AGE_DAYS;
    })
    .map(withCanonicalCity)
    .sort((a, b) => postedTs(b) - postedTs(a));
}

/**
 * Employers routinely open several ATS requisitions for one role at one site
 * (6x "Forward Deployed Engineer · Workato · Hyderabad" on one recent night).
 * Each is a distinct posting with its own apply URL, but they render
 * byte-identical pages, so the newest is nominated canonical and the rest drop
 * their markup rather than letting Google pick one arbitrarily.
 */
const dupKey = (j: Job): string => [j.title, j.companySlug, j.locationRaw ?? ""].join(" ");

/**
 * Duplicate key → slug of the posting the rest consolidate onto. Expects its
 * input in newest-first order (as `listedJobs` returns), so the first slug seen
 * for a key is the newest one.
 */
export function canonicalByDupKey(listed: Job[]): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const j of listed) if (!canonical.has(dupKey(j))) canonical.set(dupKey(j), j.slug);
  return canonical;
}

/** The slug of the posting this one duplicates, or null when it's canonical. */
export function duplicateOfIn(canonical: Map<string, string>, job: Job): string | null {
  const winner = canonical.get(dupKey(job));
  return winner && winner !== job.slug ? winner : null;
}

/**
 * Google requires a resolvable location: TELECOMMUTE roles need
 * applicantLocationRequirements (derived from country), everything else needs a
 * jobLocation. A posting with neither would be a guaranteed Search Console
 * error, so the page emits no JobPosting at all rather than a half-valid one.
 */
export function hasUsableLocation(job: Job): boolean {
  return job.remoteType === "remote"
    ? Boolean(job.country)
    : Boolean(job.city || job.region || job.country);
}

/** Slugs whose pages carry JobPosting markup: listed, canonical, and locatable. */
export function indexableSlugs(snapshot: SiteSnapshot): Set<string> {
  const listed = listedJobs(snapshot);
  const canonical = canonicalByDupKey(listed);
  return new Set(
    listed
      .filter((j) => duplicateOfIn(canonical, j) === null && hasUsableLocation(j))
      .map((j) => j.slug),
  );
}
