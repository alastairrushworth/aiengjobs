import type { APIRoute } from "astro";
import { buildJobsPayload } from "../lib/jobsPayload.ts";

// The homepage's full job list, fetched lazily by its filter script. Keeping
// this out of index.html holds the landing page at a constant size as the
// board grows (the HTML only embeds the newest 50 cards).
export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildJobsPayload()), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
