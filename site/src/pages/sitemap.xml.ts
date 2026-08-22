import type { APIRoute } from "astro";
import { LANDINGS, pageCount } from "../lib/landings.ts";
import { url } from "../lib/url.ts";
import { openJobs, generatedAt, duplicateOf } from "../lib/data.ts";

export const GET: APIRoute = ({ site }) => {
  // Trailing slashes throughout — GitHub Pages 301s the slash-less form, and a
  // sitemap full of redirects wastes crawl budget.
  const abs = (p: string) => {
    const href = new URL(url(p.endsWith("/") ? p : `${p}/`), site).href;
    return href.endsWith("/") ? href : `${href}/`; // url("/") drops the base's slash
  };
  /**
   * The date part of an ISO timestamp, and only if it really is one.
   *
   * `loc` is safe by construction — every URL goes through `new URL()`, which
   * percent-encodes anything XML would object to. `lastmod` is not: it comes
   * from `updatedAt`, which the Ashby and Greenhouse connectors pass through
   * from the feed verbatim and which nothing downstream validates. (`postedAt`
   * is incidentally protected, because a role whose posted date won't parse is
   * dropped from `openJobs` before it gets here — `updatedAt` has no such
   * guard.) Slicing to ten characters bounded the length and nothing else, so
   * ten characters of `&`, `<` or `"` would make the whole document
   * ill-formed — and a sitemap that fails to parse fails entirely, taking
   * every URL in it with it. No live row is malformed today; the shape of the
   * input is what makes that luck rather than a property.
   */
  const day = (iso?: string) => {
    const d = iso?.slice(0, 10);
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
  };

  const entries: { loc: string; lastmod?: string }[] = [
    { loc: abs("/"), lastmod: day(generatedAt) },
    { loc: abs("/stats"), lastmod: day(generatedAt) },
    { loc: abs("/mcp"), lastmod: day(generatedAt) },
  ];
  // Every listing page — clusters and locations alike — is paginated; list each
  // slice so the roles past page 1 stay discoverable (pages/[topic]/[...page]).
  for (const landing of LANDINGS) {
    entries.push({ loc: abs(`/${landing.slug}`), lastmod: day(generatedAt) });
    for (let n = 2; n <= pageCount(landing); n++) {
      entries.push({ loc: abs(`/${landing.slug}/${n}`), lastmod: day(generatedAt) });
    }
  }
  for (const slug of new Set(openJobs.map((j) => j.companySlug))) {
    entries.push({ loc: abs(`/companies/${slug}`), lastmod: day(generatedAt) });
  }
  // Closed-job tombstones are noindexed and deliberately absent here, as are
  // duplicate requisitions — they canonicalize onto the newest of their set, and
  // submitting a URL we've told Google to ignore is a contradictory signal.
  for (const j of openJobs) {
    if (duplicateOf(j)) continue;
    entries.push({
      loc: abs(`/jobs/${j.slug}`),
      lastmod: day(j.updatedAt ?? j.postedAt) ?? day(generatedAt),
    });
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
