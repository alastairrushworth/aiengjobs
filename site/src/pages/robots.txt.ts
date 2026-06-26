import type { APIRoute } from "astro";
import { url } from "../lib/url.ts";

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL(url("/sitemap.xml"), site).href;
  const body = `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
