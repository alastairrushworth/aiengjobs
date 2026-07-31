import type { APIRoute } from "astro";
import { buildRssFeed } from "../lib/feed.ts";
import { openJobs, generatedAt } from "../lib/data.ts";

export const GET: APIRoute = ({ site }) =>
  buildRssFeed({
    title: "frontierroles.com — newest AI engineering jobs",
    description:
      "The newest AI engineering roles — RAG, agents, evals, inference, fine-tuning. First-party ATS listings, refreshed nightly.",
    pagePath: "/",
    feedPath: "/rss.xml",
    jobs: openJobs,
    site,
    generatedAt,
  });
