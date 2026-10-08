import type { APIRoute } from "astro";
import { buildRssFeed } from "../lib/feed.ts";
import { uniqueOpenJobs, generatedAt } from "../lib/data.ts";

// Deduped, like the sitemap, the JobPosting markup and the MCP index.
//
// The feeds were the one surface that skipped `duplicateOf`, so an employer
// opening one requisition per office put the same role in six times — and /mcp
// promises "Deduplicated … The server returns one" on the page that links this
// feed. It also wastes the MAX_ITEMS window on repeats.
export const GET: APIRoute = ({ site }) =>
  buildRssFeed({
    title: "frontierroles.com — newest AI engineering jobs",
    description:
      "The newest AI engineering roles — RAG, agents, evals, inference, fine-tuning. First-party ATS listings, refreshed nightly.",
    pagePath: "/",
    feedPath: "/rss.xml",
    jobs: uniqueOpenJobs,
    site,
    generatedAt,
  });
