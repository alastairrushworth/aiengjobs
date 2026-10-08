import type { APIRoute } from "astro";
import { jobEntries, urlset, XML_HEADERS } from "../lib/sitemap.ts";

// The recent, canonical job pages — see lib/sitemap.ts.
export const GET: APIRoute = ({ site }) =>
  new Response(urlset(jobEntries(site)), { headers: XML_HEADERS });
