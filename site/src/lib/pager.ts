/**
 * Pagination helpers shared by every paged listing — the landings
 * ([topic]/[...page].astro) and the company pages (companies/[slug]/[...page]).
 * The pager itself is components/Pager.astro; these are here so a page can
 * compute the same prev/next URLs for its <link> tags that the pager renders.
 */

// Astro emits slice URLs without a trailing slash (trailingSlash: "ignore"),
// but GitHub Pages 301s that form — and canonicals, the sitemap and every other
// internal link here use the slash. Normalize so pagination doesn't hand
// crawlers a chain of redirects.
export const slash = (u?: string) => (u && !u.endsWith("/") ? `${u}/` : u);

/** The adjacent slices of an Astro `page`, in the trailing-slash form served. */
export function adjacentPages(page: { url: { prev?: string; next?: string } }): {
  prev?: string;
  next?: string;
} {
  return { prev: slash(page.url.prev), next: slash(page.url.next) };
}

// Newer/Older alone costs 21 clicks to reach the last page of a 22-page
// landing. A windowed run of numbers puts any page one or two hops away while
// keeping the row short enough to fit a phone.
export function pageWindow(current: number, last: number): (number | "gap")[] {
  const wanted = new Set<number>([1, last, current]);
  for (const n of [current - 1, current + 1]) {
    if (n > 1 && n < last) wanted.add(n);
  }
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const n of [...wanted].sort((a, b) => a - b)) {
    if (prev && n - prev > 1) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}
