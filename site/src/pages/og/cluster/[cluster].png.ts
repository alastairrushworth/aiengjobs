import type { APIRoute, GetStaticPaths } from "astro";
import { CLUSTERS, type SkillCluster } from "@aiengjobs/shared/taxonomy";
import { clusterCard } from "../../../lib/og/card.ts";
import { renderCard } from "../../../lib/og/render.ts";

/**
 * One card per cluster — the fallback for roles past the per-role card window.
 *
 * Ten images, generated whether or not anything currently points at them: an
 * `og:image` that 404s is worse than a generic one, because most platforms then
 * render no image rather than falling back to something else, and the whole set
 * costs under half a megabyte.
 */
export const getStaticPaths = (() =>
  CLUSTERS.map((cluster) => ({
    params: { cluster: cluster.id },
    props: { cluster },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { cluster } = props as { cluster: SkillCluster };
  return new Response(await renderCard(clusterCard(cluster)), {
    headers: {
      "Content-Type": "image/png",
      // Nothing on this card can go stale, so it can be cached hard.
      "Cache-Control": "public, max-age=604800",
    },
  });
};
