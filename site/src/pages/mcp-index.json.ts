import type { APIRoute } from "astro";
import { openJobs, generatedAt, duplicateOf, fxRates } from "../lib/data.ts";
import { CLUSTERS } from "@aiengjobs/shared/taxonomy";
import { salaryMidpointUsd } from "../lib/format.ts";
import type { Job } from "@aiengjobs/shared";

// The whole board, minus descriptions, as one file. This is what the MCP server
// holds in memory: every field an agent can filter or reason on, and nothing it
// can't. Descriptions are 21MB of the 26MB snapshot and are needed one job at a
// time, so they live behind /mcp-jobs/<slug>.json instead.
//
// Long keys, unlike the browser payload in lib/jobsPayload.ts. That file is
// fetched on every listing interaction and its short keys are load-bearing;
// this one is fetched once per process and served gzipped (1.7MB -> ~0.35MB),
// so legibility is worth more than the bytes — it doubles as the public data
// feed, and a third party reading it shouldn't need our decoder ring.
//
// Duplicates are omitted. Employers routinely open one requisition per office
// for the same role; the site renders those as canonical-pointing pages, but an
// agent asking for "forward deployed engineer" wants one hit, not six.

export interface McpJob {
  slug: string;
  title: string;
  company: string;
  companySlug: string;
  applyUrl: string;
  location: string | null;
  country: string | null;
  city: string | null;
  remote: string | null;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  /** Annualised midpoint in USD, or null when the role is unpriced. */
  salaryUsd: number | null;
  skills: string[];
  clusters: string[];
  postedAt: string | null;
}

export function toMcpJob(j: Job): McpJob {
  return {
    slug: j.slug,
    title: j.title,
    company: j.companyName,
    companySlug: j.companySlug,
    applyUrl: j.applyUrl,
    location: j.locationRaw ?? null,
    country: j.country ?? null,
    city: j.city ?? null,
    remote: j.remoteType ?? null,
    seniority: j.seniority ?? null,
    salaryMin: j.salaryMin ?? null,
    salaryMax: j.salaryMax ?? null,
    salaryCurrency: j.salaryCurrency ?? null,
    salaryPeriod: j.salaryPeriod ?? null,
    // Precomputed rather than left to the client. The site's implementation
    // already handles period conversion, unknown currencies (unpriced, not 1:1
    // with USD) and the sanity floor/ceiling; reimplementing that in the MCP
    // server would be two copies of a subtle calculation drifting apart.
    salaryUsd: salaryMidpointUsd(j, fxRates),
    skills: j.skills,
    clusters: j.clusters,
    postedAt: j.postedAt ?? null,
  };
}

/** Canonical open roles — the set both this index and /mcp-jobs are built from. */
export const mcpJobs: Job[] = openJobs.filter((j) => duplicateOf(j) === null);

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      // Every response the MCP server builds carries this through, so an agent
      // can say how fresh the board is instead of implying it's live.
      generatedAt,
      jobCount: mcpJobs.length,
      // Shipped with the data so the MCP server needs no dependency on the
      // taxonomy module and can never drift from the tags actually in use —
      // it's how an agent learns which skill and cluster names are real
      // instead of guessing "PyTorch" vs "pytorch" vs "Torch".
      clusters: CLUSTERS.map((c) => ({ id: c.id, label: c.label, skills: c.skills })),
      // Currency -> multiplier to USD at generation time. Salaries stay in
      // their posted currency; this is what makes them comparable.
      fxRates,
      jobs: mcpJobs.map(toMcpJob),
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
