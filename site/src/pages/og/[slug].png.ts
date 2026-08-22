import type { APIRoute, GetStaticPaths } from "astro";
import type { Job } from "@aiengjobs/shared";
import { jobCard } from "../../lib/og/card.ts";
import { logoDataUri } from "../../lib/og/logo.ts";
import { cardJobs } from "../../lib/og/policy.ts";
import { renderCard } from "../../lib/og/render.ts";
import { fxRates } from "../../lib/data.ts";

/**
 * The share card for one role: /og/<slug>.png.
 *
 * Its own route rather than /jobs/<slug>/og.png, which would sit inside the
 * directory [slug].astro already owns. Nothing about that is illegal, but the
 * two routes would then differ only in whether a trailing segment is a file,
 * and this is a build that emits 6,000 job directories — keeping the images in
 * one flat namespace makes it obvious what is generated and what is a page.
 *
 * Which roles get one is decided in lib/og/policy.ts; that module is also what
 * jobs/[slug].astro asks for the URL, so the page can never point at a card
 * this route did not build.
 */
export const getStaticPaths = (() =>
  cardJobs.map((job) => ({
    params: { slug: job.slug },
    props: { job },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { job } = props as { job: Job };
  const png = await renderCard(
    jobCard({ job, logoUri: logoDataUri(job.companySlug), fxRates }),
  );
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      // Cards are regenerated nightly but their content only changes when the
      // role does, and social platforms re-fetch on their own schedule anyway.
      "Cache-Control": "public, max-age=86400",
    },
  });
};
