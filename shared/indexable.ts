import type { Job, SiteSnapshot } from "./types.ts";
import { canonicalCity } from "./city.ts";
import { decodeEntities } from "./text.ts";

/**
 * Which /jobs/<slug>/ URLs actually carry JobPosting markup.
 *
 * Four independent rules decide that, and the site applies them in three
 * different places: the age cutoff and duplicate consolidation in
 * site/src/lib/data.ts, and Google's insistence on a resolvable location and
 * a real description in jobs/[slug].astro. A page that fails any of them still
 * exists and is still applicable — it just renders without the structured data.
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
 * unknown date as fresh. Delisted roles are tombstones, not listings, exactly
 * like closed ones.
 */
export function listedJobs(snapshot: SiteSnapshot): Job[] {
  return snapshot.jobs
    .filter((j) => !j.isClosed && !j.isDelisted)
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
 * A second way to be the same job: one advert posted once per city, with the
 * city written into the title and nothing else changed.
 *
 * Speechify had 245 of these on 2026-11-20 — "Software Engineer, AI Data - Las
 * Vegas, NV, USA" and 143 siblings sharing one location ("Remote") and one
 * description to the byte — which made a single role 7% of the board, a third
 * of /remote-ai-jobs and the top row of "Most open positions" on /stats. The
 * key above can't see it, because the titles differ.
 *
 * So: same employer, same raw location, the same title once a trailing
 * " - suffix" is dropped, and the same description. All four, because each
 * alone is wrong somewhere on the board:
 *
 * - The suffix is usually not a place. "Software Engineer - Inference
 *   Product" and "Software Engineer - Storage Systems" are two jobs, and 56
 *   such groups sit beside Speechify's. Their descriptions differ; that is
 *   what tells a team from a city without a gazetteer.
 * - An identical description alone isn't a duplicate either: Field AI files
 *   17 different roles in Irvine under one boilerplate text.
 * - Speechify's own adverts differ by country in exactly one line — the pay
 *   band — and those 27 stay separate pages, each with its own figure.
 *
 * Null when the title has no suffix or the description is too short to vouch
 * for anything (closed rows carry none at all).
 */
const TITLE_SUFFIX = /^(.*\S)\s+[-–—]\s+\S/;
const MIN_REPOST_TEXT = 200;
const repostKey = (j: Job): string | null => {
  const stem = TITLE_SUFFIX.exec(j.title)?.[1];
  if (!stem) return null;
  const text = (j.descriptionText ?? "").replace(/\s+/g, " ").trim();
  if (text.length < MIN_REPOST_TEXT) return null;
  // NUL-joined, so no field can run into the next and forge another's key.
  return ["repost", stem, j.companySlug, j.locationRaw ?? "", text].join("\u0000");
};

/**
 * Duplicate key → slug of the posting the rest consolidate onto. Expects its
 * input in newest-first order (as `listedJobs` returns), so the newest of each
 * set is the one the others fold into.
 *
 * A posting can match others on either key, and the two relations chain — A
 * and B share a title, B and C are reposts of one advert — so the sets are
 * merged rather than looked up: every member of a chain resolves to the one
 * newest posting, never to a page that itself points somewhere else.
 */
export function canonicalByDupKey(listed: Job[]): Map<string, string> {
  const order = new Map<string, number>();
  listed.forEach((j, i) => {
    if (!order.has(j.slug)) order.set(j.slug, i);
  });
  const parent = new Map<string, string>();
  const find = (slug: string): string => {
    let root = slug;
    for (let up = parent.get(root); up !== undefined; up = parent.get(root)) root = up;
    return root;
  };

  // The first posting seen for each key, then every later holder of that key
  // merged into its set — keeping whichever root came first in the input.
  const holder = new Map<string, string>();
  for (const j of listed) {
    for (const key of [dupKey(j), repostKey(j)]) {
      if (key === null) continue;
      const first = holder.get(key);
      if (first === undefined) {
        holder.set(key, j.slug);
        continue;
      }
      const a = find(first);
      const b = find(j.slug);
      if (a === b) continue;
      if (order.get(a)! <= order.get(b)!) parent.set(b, a);
      else parent.set(a, b);
    }
  }

  const canonical = new Map<string, string>();
  for (const [key, slug] of holder) canonical.set(key, find(slug));
  return canonical;
}

/**
 * The slug of the posting this one duplicates, or null when it's canonical.
 *
 * Read through the title key alone: every posting has one, and
 * `canonicalByDupKey` has already resolved it to the head of whatever set the
 * posting ended up in, by either route.
 */
export function duplicateOfIn(canonical: Map<string, string>, job: Job): string | null {
  const winner = canonical.get(dupKey(job));
  return winner && winner !== job.slug ? winner : null;
}

/**
 * Google requires a resolvable location, and in both shapes that means a
 * country. TELECOMMUTE roles need applicantLocationRequirements, which is
 * derived from country. Everything else needs a jobLocation, whose address has
 * exactly one *required* field — addressCountry. addressLocality and
 * addressRegion are recommended, not sufficient.
 *
 * Accepting a city alone is what produced Search Console's "Missing field
 * addressCountry (in jobLocation.address)": on the board the day it was
 * reported, 46 roles knew their city and not their country and each published a
 * PostalAddress Google rejects. The rule was always meant to keep half-valid
 * markup off the site — a posting without a country now emits no JobPosting at
 * all, which is the outcome the paragraph above already promised.
 */
export function hasUsableLocation(job: Job): boolean {
  return Boolean(job.country);
}

/**
 * Google requires `description` to be the advert — "the full description of
 * the job" — and a posting whose feed carried none has nothing to put there.
 * The page used to fill the gap with a sentence of its own ("<title> at
 * <company>. Apply on the company's site."), which is markup describing a job
 * the page itself does not describe: two HSBC roles on 2026-11-20, whose feed
 * supplies no text. No advert, no JobPosting; the page still renders and still
 * links to the employer.
 *
 * Any letter or digit counts, read after entities are decoded: the page
 * builds its paragraphs from the decoded text, and every line this accepts is
 * a line that survives into them — so a posting this function passes always
 * has a description to emit.
 */
export function hasDescription(job: Job): boolean {
  return /[\p{L}\p{N}]/u.test(decodeEntities(job.descriptionText ?? ""));
}

/** Slugs whose pages carry JobPosting markup: listed, canonical, locatable and described. */
export function indexableSlugs(snapshot: SiteSnapshot): Set<string> {
  const listed = listedJobs(snapshot);
  const canonical = canonicalByDupKey(listed);
  return new Set(
    listed
      .filter(
        (j) =>
          duplicateOfIn(canonical, j) === null && hasUsableLocation(j) && hasDescription(j),
      )
      .map((j) => j.slug),
  );
}
