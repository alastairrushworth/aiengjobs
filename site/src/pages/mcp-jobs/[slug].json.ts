import type { APIRoute, GetStaticPaths } from "astro";
import { companyBySlug, generatedAt } from "../../lib/data.ts";
import { url } from "../../lib/url.ts";
import { mcpJobs, toMcpJob } from "../mcp-index.json.ts";
import type { Job } from "@aiengjobs/shared";

// One file per role, carrying the description the index deliberately omits.
// Fetched only when an agent drills into a specific job, which is the whole
// point of splitting them: a search returning 25 roles costs ~2k tokens here
// instead of ~30k.
//
// Served full-fidelity — truncation is the client's call, not ours. The MCP
// server trims to a token budget; a human or a script reading this directly
// gets the whole advert.

export const getStaticPaths = (() =>
  mcpJobs.map((job) => ({
    params: { slug: job.slug },
    props: { job },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props, site }) => {
  const { job } = props as { job: Job };
  const company = companyBySlug.get(job.companySlug);

  return new Response(
    JSON.stringify({
      generatedAt,
      ...toMcpJob(job),
      // Plain text only. The HTML variant is employer-authored markup that
      // would land straight in an agent's context, and stripping tags is the
      // cheapest thing we can do about that.
      description: job.descriptionText ?? null,
      // Flat, and `company` stays the name string it is in the index — nesting
      // an object under the same key here would give the two endpoints
      // different shapes for the same field.
      companyDomain: company?.domain ?? null,
      companyDescription: company?.description ?? null,
      // Where a human would read the same role, so an agent can cite it.
      // Trailing slash and derived from `site`, not hardcoded: the slash-less
      // form 301s on Pages, and this is a URL agents hand straight to users.
      jobUrl: new URL(url(`/jobs/${job.slug}/`), site).href,
    }),
    {
      headers: {
        // Content-Type only. `output: "static"` runs this at build time and
        // writes the BODY to disk — the Response headers are dropped, so a
        // Cache-Control set here never reaches a client. GitHub Pages serves
        // its own (~10 min). Caching for this endpoint belongs to the
        // Cloudflare Worker in front of mcp.frontierroles.com, which is the one
        // place that can actually set it.
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
};
