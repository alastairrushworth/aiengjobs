import type { APIRoute } from "astro";
import { url } from "../lib/url.ts";

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL(url("/sitemap.xml"), site).href;
  // The JSON surface is machine-readable data, not pages: ~2,026 URLs against
  // 2,525 indexable ones, and none of it is in the sitemap. Crawling it can
  // only dilute the budget for the pages that are meant to rank. /mcp links
  // mcp-index.json directly and Google follows JSON links, so this needs
  // saying rather than leaving to inference.
  //
  // mcp-index.json itself stays allowed — it's deliberately advertised as a
  // public feed on /mcp. Nothing here is sensitive either way: these files
  // carry only fields already rendered on the pages.
  //
  // Query strings are filter state, never a page. The board is static: every
  // URL worth indexing is a clean path and sits in the sitemap, so `?skill=`,
  // `?level=` and `?country=` only ever produce a copy of a listing that
  // canonicalises straight back to it. Google was paying to fetch a four-figure
  // pile of those while job pages waited two weeks between crawls (see
  // FILTER_LINK_REL in lib/url.ts). The links carry rel="nofollow" to stay out
  // of the queue; this refuses the fetch for anything that gets in anyway.
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /mcp-jobs/",
    "Disallow: /*jobs-data.json$",
    "Disallow: /*?",
    `Sitemap: ${sitemap}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
