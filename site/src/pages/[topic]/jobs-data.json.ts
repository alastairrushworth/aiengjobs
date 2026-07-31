import type { APIRoute, GetStaticPaths } from "astro";
import { buildJobsPayload } from "../../lib/jobsPayload.ts";
import { LANDINGS, type Landing } from "../../lib/landings.ts";

// One payload per listing page, so a landing's filter bar can narrow that
// landing's roles without shipping the whole board and scoping client-side.
//
// A per-landing file rather than a cluster/city key on the shared payload: the
// scoping is then a URL, not a predicate the client has to get right, and each
// landing fetches only what it can show — /ai-agent-jobs pulls 688 roles, not
// 1,709. Costs one small JSON per landing at build time.
export const getStaticPaths = (() =>
  LANDINGS.map((landing) => ({
    params: { topic: landing.slug },
    props: { landing },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  const { landing } = props as { landing: Landing };
  return new Response(JSON.stringify(buildJobsPayload(landing.jobs)), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
