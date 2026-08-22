import type { Job } from "@aiengjobs/shared";
import { agedOutJobs, closedJobs, generatedAt, openJobs } from "../data.ts";
import { dailyPickSlugs } from "../dailyPicks.ts";
import { url } from "../url.ts";

/**
 * How recently a role must have appeared for it to get its own share card.
 *
 * Not every role gets one, and the reason is bytes rather than principle: a card
 * is ~37KB, the board carries 4,917 open roles, and generating the lot adds
 * ~177MB to a `dist` that is already 163MB. Thirty days covers ~1,900 roles for
 * ~68MB.
 *
 * The window works because sharing is front-loaded — a role is posted, picked up
 * and passed around in its first days — and because the platforms cache what
 * they first saw. A link that gets its tailored card in week one keeps rendering
 * that card long after this stops generating it. What the older roles fall back
 * to is a card for their cluster, which still says something true about the job.
 */
export const OG_CARD_MAX_AGE_DAYS = 30;

/** Days since a role appeared: its posted date, or failing that, when we saw it. */
function ageDays(job: Job): number {
  const stamp = job.postedAt ?? job.ingestedAt;
  const age = (Date.parse(generatedAt) - Date.parse(stamp)) / 86_400_000;
  return Number.isFinite(age) ? age : Infinity;
}

/**
 * Every role the build renders a card for.
 *
 * Tombstones are in scope deliberately. A closed or aged-out role still has a
 * page — that is the entire point of keeping one — and the links being shared
 * when it closes are exactly the ones already circulating. Dropping the card at
 * the moment the role goes stale would leave those shares with a broken image.
 */
export const cardJobs: Job[] = (() => {
  const picked = dailyPickSlugs();
  const seen = new Set<string>();
  const out: Job[] = [];
  for (const job of [...openJobs, ...closedJobs, ...agedOutJobs]) {
    if (seen.has(job.slug)) continue;
    // Anything the daily feed has announced gets a card whatever its age: those
    // links went out to subscribers with the card as the reason to click.
    if (ageDays(job) > OG_CARD_MAX_AGE_DAYS && !picked.has(job.slug)) continue;
    seen.add(job.slug);
    out.push(job);
  }
  return out;
})();

const cardSlugs = new Set(cardJobs.map((j) => j.slug));

/**
 * The `og:image` for a role's page, absolute-path form.
 *
 * Three tiers, narrowing as the data thins: the role's own card, a card for its
 * first cluster, and the site-wide default. Every page gets *something* — an
 * `og:image` that 404s is worse than a generic one, because most platforms then
 * render no image at all rather than falling back.
 */
export function ogImagePath(job: Job): string {
  if (cardSlugs.has(job.slug)) return url(`/og/${job.slug}.png`);
  if (job.clusters.length > 0) return url(`/og/cluster/${job.clusters[0]}.png`);
  return url("/og-default.png");
}
