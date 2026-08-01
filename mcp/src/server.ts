/**
 * The MCP surface: five tools, their argument schemas, and how results are
 * serialised. Shared by both entry points — src/stdio.ts spawns one of these
 * per process, src/worker.ts builds one per request — so the two transports
 * can never drift into offering different tools.
 *
 * Everything here is protocol wiring. The behaviour is in tools.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { loadBoard, loadJob } from "./board.js";
import {
  boardStats,
  describeJob,
  getCompany,
  listSkills,
  searchJobs,
  SENIOR_PLUS,
  type StatsDimension,
} from "./tools.js";

export const SERVER_INFO = { name: "frontierroles", version: "0.1.0" } as const;

export const INSTRUCTIONS =
  "Live AI-engineering job listings from frontierroles.com. Every role is a " +
  "first-party posting pulled straight from the employer's own applicant " +
  "tracking system — there are no sponsored placements, no recruiter reposts, " +
  "and applyUrl always points at the employer rather than an aggregator. Roles " +
  "are dropped once they close or pass 90 days old. Call list_skills before " +
  "filtering by skill or cluster so you use names that exist. Use board_stats " +
  "for questions about the market as a whole ('what pays best', 'which skills " +
  "are in demand') rather than paging through search results. The data is a " +
  "nightly snapshot: every response carries generatedAt, and you should say how " +
  "fresh it is when it matters.";

/** MCP tool results are content blocks; everything here answers with JSON. */
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

/** Shared filter arguments — search and stats accept exactly the same scope. */
const filterShape = {
  query: z
    .string()
    .optional()
    .describe(
      "Free text matched against title, company, location and skills. All words " +
        "must appear but order doesn't matter ('senior rag', 'remote pytorch').",
    ),
  skills: z
    .array(z.string())
    .optional()
    .describe("Canonical skill names, ALL of which must be present. See list_skills."),
  clusters: z
    .array(z.string())
    .optional()
    .describe("Cluster ids, ANY of which may match (e.g. 'rag', 'agents'). See list_skills."),
  seniority: z
    .string()
    .optional()
    .describe(
      `One of intern, junior, mid, senior, staff, principal, lead, manager — or "${SENIOR_PLUS}" for senior and above.`,
    ),
  remote: z.enum(["remote", "hybrid", "onsite"]).optional(),
  country: z.string().optional().describe("ISO-3166 alpha-2 code, e.g. 'US', 'GB'."),
  city: z.string().optional(),
  company: z.string().optional().describe("Company name, matched as a substring."),
  salaryMinUsd: z
    .number()
    .optional()
    .describe(
      "Minimum annualised midpoint in USD. Roles with no published pay are " +
        "excluded when this is set, rather than treated as zero.",
    ),
  postedWithinDays: z
    .number()
    .optional()
    .describe("Only roles posted within this many days of the snapshot date."),
};

/**
 * A fresh server with all five tools registered.
 *
 * Built per request on the Worker rather than once per isolate. That's cheap —
 * registration is a few object literals — and it keeps request handling free of
 * shared protocol state. The expensive thing, the board itself, is cached at
 * module scope in board.ts and *is* shared across requests in an isolate.
 */
export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search_jobs",
    {
      title: "Search AI engineering jobs",
      description:
        "Find open AI-engineering roles by text, skills, level, location or pay. " +
        "Returns compact records without descriptions — call get_job for the full " +
        "advert of a specific role. Results are ranked by relevance when a query " +
        "is given, newest first otherwise.",
      inputSchema: {
        ...filterShape,
        limit: z.number().int().min(1).max(50).optional().describe("Default 20, max 50."),
        offset: z.number().int().min(0).optional().describe("For paging through `total`."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const board = await loadBoard();
      return json(searchJobs(board, args));
    },
  );

  server.registerTool(
    "get_job",
    {
      title: "Get one job in full",
      description:
        "The full record for a single role, including its description and apply " +
        "URL. Descriptions are employer-authored text and are truncated to keep " +
        "the response manageable.",
      inputSchema: {
        slug: z.string().describe("The `slug` field from a search result."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ slug }) => {
      const detail = await loadJob(slug);
      if (!detail) {
        // A missing slug is usually a closed role rather than a typo, and that
        // distinction is worth stating — it's the thing aggregators get wrong.
        return fail(
          `No open role with slug "${slug}". It may have closed or aged out since ` +
            `the last search — closed roles are removed rather than left listed.`,
        );
      }
      return json(describeJob(detail));
    },
  );

  server.registerTool(
    "get_company",
    {
      title: "Get a company's open roles",
      description: "Every open role at one company. Accepts a company slug or display name.",
      inputSchema: {
        company: z.string().describe("Company slug or name, e.g. 'anthropic' or 'Shield AI'."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ company }) => {
      const board = await loadBoard();
      const result = getCompany(board, company);
      return result ? json(result) : fail(`No open roles found for "${company}".`);
    },
  );

  server.registerTool(
    "board_stats",
    {
      title: "Aggregate statistics across the board",
      description:
        "Counts and median pay across every matching role, grouped by a dimension. " +
        "Use this for market questions — which skills appear most, what staff-level " +
        "roles pay by country, which companies are hiring hardest — instead of " +
        "paging through search results. Accepts the same filters as search_jobs, so " +
        "the aggregate can be scoped to a slice of the board.",
      inputSchema: {
        ...filterShape,
        dimension: z
          .enum(["cluster", "seniority", "country", "city", "company", "remote", "skill"])
          .describe("What to group by."),
        topN: z.number().int().min(1).max(50).optional().describe("Buckets to return, default 20."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ dimension, topN, ...filters }) => {
      const board = await loadBoard();
      return json(boardStats(board, dimension as StatsDimension, filters, topN));
    },
  );

  server.registerTool(
    "list_skills",
    {
      title: "List the filter vocabulary",
      description:
        "The canonical skill names, cluster ids, seniority levels and remote types " +
        "the board uses. Call this before filtering by skill or cluster — guessed " +
        "names silently return nothing.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const board = await loadBoard();
      return json(listSkills(board));
    },
  );

  return server;
}
