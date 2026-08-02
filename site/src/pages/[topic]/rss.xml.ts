import type { APIRoute, GetStaticPaths } from "astro";
import { buildRssFeed } from "../../lib/feed.ts";
import { LANDINGS, type Landing } from "../../lib/landings.ts";
import { generatedAt, duplicateOf } from "../../lib/data.ts";

// A feed per listing page — "new RAG roles", "new jobs in London". Cheap to
// emit, and it's the format aggregators and newsletter tooling actually consume.
export const getStaticPaths = (() =>
  LANDINGS.map((landing) => ({
    params: { topic: landing.slug },
    props: { landing },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ site, props }) => {
  const { landing } = props as { landing: Landing };
  return buildRssFeed({
    title: `${landing.h1} — frontierroles.com`,
    description: landing.intro,
    pagePath: `/${landing.slug}/`,
    feedPath: `/${landing.slug}/rss.xml`,
    // Deduped like every other consumer of the board — see rss.xml.ts.
    jobs: landing.jobs.filter((j) => duplicateOf(j) === null),
    site,
    generatedAt,
  });
};
