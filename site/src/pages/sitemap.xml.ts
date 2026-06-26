import type { APIRoute } from "astro";
import snapshot from "../data/snapshot.json";
import { CLUSTER_PAGES } from "../lib/clusters.ts";
import { url } from "../lib/url.ts";
import type { SiteSnapshot } from "@aiengjobs/shared";

export const GET: APIRoute = ({ site }) => {
  const data = snapshot as unknown as SiteSnapshot;
  const open = data.jobs.filter((j) => !j.isClosed);
  const abs = (p: string) => new URL(url(p), site).href;

  const paths: string[] = ["/"];
  for (const p of CLUSTER_PAGES) {
    paths.push(`/${p.slug}`);
    paths.push(`/salaries/${p.id}`);
  }
  for (const slug of new Set(open.map((j) => j.companySlug))) {
    paths.push(`/companies/${slug}`);
  }
  for (const j of open) paths.push(`/jobs/${j.slug}`);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${abs(p)}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
