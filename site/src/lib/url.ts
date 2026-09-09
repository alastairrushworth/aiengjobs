// Prefix an internal path with the configured base path ("/" today, since the
// site sits at its domain apex — kept for the day it doesn't).
// Astro exposes the base as import.meta.env.BASE_URL (with a trailing slash).
const BASE = import.meta.env.BASE_URL;

export function url(path = "/"): string {
  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  const p = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}` || "/";
}

/**
 * The listing, filtered — the target of every skill badge on a card, every row
 * on /stats and every quick link that means "show me this slice".
 *
 * Built as the trailing-slash form GitHub Pages serves rather than pointing
 * hundreds of internal links at a redirect. url("/") already returns "/" at the
 * domain apex; under a non-root base it drops the trailing slash, hence the
 * check.
 */
export function jobsUrl(params: Record<string, string> = {}): string {
  const home = url("/");
  const path = home.endsWith("/") ? home : `${home}/`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * `rel` for every link that carries filter state in a query string.
 *
 * These are UI affordances, not pages: each one canonicalises back to the
 * listing it filters, so Google folds it away after paying to fetch it. That
 * was free until the crawl budget wasn't — a landing page emits ~38 distinct
 * `?skill=` links, /stats adds `?level=` and `?country=`, and across ~60
 * landings that is a four-figure pile of URLs competing with the 3,538 job
 * pages that have to be re-fetched before their `validThrough` lapses, at a
 * crawl rate of ~350/day. robots.txt refuses the fetch; this keeps them out of
 * the crawl queue in the first place. Neither affects a human clicking one.
 */
export const FILTER_LINK_REL = "nofollow";
