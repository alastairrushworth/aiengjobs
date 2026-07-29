import type { APIRoute } from "astro";
import { CLUSTER_PAGES, salarySlug } from "../lib/clusters.ts";
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
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

  const entries: { loc: string; lastmod?: string }[] = [
    { loc: abs("/"), lastmod: day(generatedAt) },
    { loc: abs("/stats"), lastmod: day(generatedAt) },
    { loc: abs("/salaries"), lastmod: day(generatedAt) },
  ];
  // Every listing page — clusters and locations alike — is paginated; list each
  // slice so the roles past page 1 stay discoverable (pages/[topic]/[...page]).
  for (const landing of LANDINGS) {
    entries.push({ loc: abs(`/${landing.slug}`), lastmod: day(generatedAt) });
    for (let n = 2; n <= pageCount(landing); n++) {
      entries.push({ loc: abs(`/${landing.slug}/${n}`), lastmod: day(generatedAt) });
    }
  }
  for (const p of CLUSTER_PAGES) {
    entries.push({ loc: abs(`/salaries/${salarySlug(p.id)}`), lastmod: day(generatedAt) });
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
