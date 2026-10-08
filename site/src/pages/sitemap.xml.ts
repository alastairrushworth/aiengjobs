import type { APIRoute } from "astro";
import { url } from "../lib/url.ts";
import {
  hubEntries,
  jobEntries,
  newestLastmod,
  sitemapIndex,
  XML_HEADERS,
} from "../lib/sitemap.ts";

// The index. This is the URL robots.txt names and Search Console has had since
// launch, so it keeps its address; the two files it points at are what changed
// (lib/sitemap.ts says why there are two).
export const GET: APIRoute = ({ site }) => {
  const child = (p: string) => new URL(url(p), site).href;
  return new Response(
    sitemapIndex([
      { loc: child("/sitemap-hubs.xml"), lastmod: newestLastmod(hubEntries(site)) },
      { loc: child("/sitemap-jobs.xml"), lastmod: newestLastmod(jobEntries(site)) },
    ]),
    { headers: XML_HEADERS },
  );
};
