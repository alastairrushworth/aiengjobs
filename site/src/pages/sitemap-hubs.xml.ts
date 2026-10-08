import type { APIRoute } from "astro";
import { hubEntries, urlset, XML_HEADERS } from "../lib/sitemap.ts";

// Every indexable page that isn't a job — see lib/sitemap.ts.
export const GET: APIRoute = ({ site }) =>
  new Response(urlset(hubEntries(site)), { headers: XML_HEADERS });
