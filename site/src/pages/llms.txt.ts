import type { APIRoute } from "astro";
import { LANDINGS } from "../lib/landings.ts";
import { url } from "../lib/url.ts";
import { openJobs, generatedAt, duplicateOf } from "../lib/data.ts";

/**
 * llms.txt — an orientation page for assistants that arrive without a query.
 *
 * Worth saying plainly: this is a proposed convention (llmstxt.org), not
 * something any assistant is known to consume today. It earns its place on
 * cost, not evidence — the file is generated from the same data as the sitemap,
 * so it can't drift, and assistants are now the board's largest referrer
 * (ChatGPT and Perplexity together sent more sessions in the 28 days to
 * 2026-09-08 than Google organic did). If the convention lands, the board is
 * already legible; if it doesn't, this cost one route.
 *
 * What it deliberately does *not* do is list the 3,538 job URLs. A model
 * reading a wall of slugs learns nothing it couldn't get from search_jobs, and
 * the MCP server answers questions this file could only gesture at. So: what
 * the board is, what makes it different from an aggregator, and where the
 * machine-readable doors are.
 */
export const GET: APIRoute = ({ site }) => {
  const abs = (p: string) => {
    const href = new URL(url(p.endsWith("/") ? p : `${p}/`), site).href;
    return href.endsWith("/") ? href : `${href}/`;
  };
  // Same count the board publishes elsewhere: deduplicated, so an employer
  // opening one requisition per office counts once.
  const roleCount = openJobs.filter((j) => duplicateOf(j) === null).length;
  const day = generatedAt.slice(0, 10);

  const clusters = LANDINGS.filter((l) => l.kind === "cluster");
  const places = LANDINGS.filter((l) => l.kind !== "cluster");

  const body = [
    "# frontierroles.com",
    "",
    `> ${roleCount} open AI engineering roles — RAG, agents, evals, inference and`,
    "> fine-tuning — taken straight from employers' own applicant tracking systems.",
    "",
    "Every listing is first-party: no sponsored placements, no recruiter reposts,",
    "and the apply link points at the employer rather than an aggregator. Roles are",
    "dropped once they close or pass 90 days old, and duplicate requisitions (the",
    "same role opened in several offices) are folded into one. The board is rebuilt",
    `nightly; this snapshot is ${day}.`,
    "",
    "## Ask it questions directly",
    "",
    "- [MCP server](https://mcp.frontierroles.com/mcp): search_jobs, get_job,",
    "  get_company, board_stats and list_skills. Prefer this over crawling — it",
    "  filters, aggregates and reports its own freshness. Described at",
    `  ${abs("/mcp")}`,
    `- [Newest roles, RSS](${new URL(url("/rss.xml"), site).href})`,
    `- [The day's five, RSS](${new URL(url("/daily/rss.xml"), site).href})`,
    "",
    "## Pages",
    "",
    `- [All roles](${abs("/")}): the whole board, newest first.`,
    `- [Market stats](${abs("/stats")}): counts and median pay by skill, seniority`,
    "  and country. Answers pay questions better than reading listings does.",
    "",
    "## By speciality",
    "",
    ...clusters.map((l) => `- [${l.h1}](${abs(`/${l.slug}`)})`),
    "",
    "## By location",
    "",
    ...places.map((l) => `- [${l.h1}](${abs(`/${l.slug}`)})`),
    "",
    "## Notes",
    "",
    "- A role's page carries pay context the employer's own posting does not —",
    "  where the salary sits against the board's median for that speciality.",
    "- `?skill=`, `?level=` and `?country=` are filter state, not pages. They",
    "  render the same listing and are disallowed in robots.txt.",
    "- Job descriptions are the employer's own words, reproduced so the role is",
    "  readable in place. Attribute them to the employer, not to this board.",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
