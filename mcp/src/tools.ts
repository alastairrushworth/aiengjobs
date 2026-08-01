/**
 * What the tools actually do, as plain functions over a Board.
 *
 * No MCP types in here on purpose. The protocol layer (src/stdio.ts, and a
 * Worker later) is a thin wrapper that validates arguments and serialises the
 * return value; everything worth testing lives here and is tested directly.
 */

import type { Board, JobDetail, McpJob } from "./board.js";

/* ------------------------------------------------------------------ search */

/**
 * Seniority shorthand. "Senior or above" is the most common thing anyone wants
 * to say about level and the one thing a plain enum can't express — the site's
 * filter bar carries the same idea, and an agent shouldn't have to enumerate
 * four values to ask a simple question.
 */
export const SENIOR_PLUS = "senior+";
const SENIOR_PLUS_LEVELS = ["senior", "staff", "principal", "lead", "manager"];

export interface SearchParams {
  query?: string;
  skills?: string[];
  clusters?: string[];
  seniority?: string;
  remote?: string;
  country?: string;
  city?: string;
  company?: string;
  salaryMinUsd?: number;
  postedWithinDays?: number;
  limit?: number;
  offset?: number;
}

/** Hard ceiling, regardless of what the caller asks for. A tool that can be
 *  talked into returning the whole board is a token bomb and a cost risk. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const lower = (s: string) => s.toLowerCase();

/**
 * The haystack a free-text query is matched against. Titles, company, location,
 * level and skills — not descriptions, which aren't in the index. That's a
 * deliberate trade: description search would mean either shipping 21MB or
 * standing up a search service, and on a board this size the title and skill
 * tags carry almost all the signal.
 */
function haystack(j: McpJob): string {
  return lower(
    [j.title, j.company, j.location ?? "", j.seniority ?? "", j.skills.join(" ")].join(" "),
  );
}

/**
 * Every term must appear somewhere, in any order — the semantics the site's
 * filter uses. Matching the terms as one adjacent phrase is the obvious
 * implementation and it's wrong: "senior rag" and "remote python" are how
 * people actually search a job board, and both return nothing under a phrase
 * match.
 */
function terms(query: string): string[] {
  return lower(query).split(/\s+/).filter(Boolean);
}

/** Title hits outrank incidental ones, then newer outranks older. */
function relevance(j: McpJob, ts: string[]): number {
  const title = lower(j.title);
  let score = 0;
  for (const t of ts) {
    if (title.includes(t)) score += 3;
    else score += 1;
  }
  return score;
}

const postedMs = (j: McpJob): number => (j.postedAt ? Date.parse(j.postedAt) || 0 : 0);

export interface SearchResult {
  generatedAt: string;
  total: number;
  offset: number;
  returned: number;
  jobs: McpJob[];
}

/**
 * The filter predicate, built once per call.
 *
 * Extracted so `searchJobs` and `boardStats` share one definition of what a
 * filter means — a stat scoped to "staff-level RAG roles" has to describe
 * exactly the set a search for the same thing returns, and two hand-kept copies
 * of this logic would not stay that way.
 */
export function matcher(board: Board, params: SearchParams): (j: McpJob) => boolean {
  const ts = params.query ? terms(params.query) : [];
  const wantSkills = (params.skills ?? []).map(lower);
  const wantClusters = (params.clusters ?? []).map(lower);
  const level = params.seniority ? lower(params.seniority) : null;
  const levels = level === SENIOR_PLUS ? SENIOR_PLUS_LEVELS : level ? [level] : null;

  // Ages are measured against the snapshot date, not wall-clock now. The board
  // is a nightly export, so "posted in the last 7 days" has to mean seven days
  // before the data was generated or the window silently shrinks as the
  // snapshot gets older.
  const genMs = Date.parse(board.generatedAt);
  const cutoff =
    params.postedWithinDays != null ? genMs - params.postedWithinDays * 86_400_000 : null;

  return (j: McpJob): boolean => {
    if (ts.length) {
      const hay = haystack(j);
      if (!ts.every((t) => hay.includes(t))) return false;
    }
    if (wantSkills.length) {
      const have = j.skills.map(lower);
      if (!wantSkills.every((s) => have.includes(s))) return false;
    }
    if (wantClusters.length) {
      const have = j.clusters.map(lower);
      if (!wantClusters.some((c) => have.includes(c))) return false;
    }
    if (levels && !levels.includes(lower(j.seniority ?? ""))) return false;
    if (params.remote && lower(j.remote ?? "") !== lower(params.remote)) return false;
    if (params.country && lower(j.country ?? "") !== lower(params.country)) return false;
    if (params.city && lower(j.city ?? "") !== lower(params.city)) return false;
    if (params.company && !lower(j.company).includes(lower(params.company))) return false;
    // Unpriced roles are excluded by a pay floor rather than treated as zero:
    // "at least $150k" should not surface roles whose pay nobody published.
    if (params.salaryMinUsd != null && (j.salaryUsd ?? -1) < params.salaryMinUsd) return false;
    if (cutoff != null && postedMs(j) < cutoff) return false;
    return true;
  };
}

export function searchJobs(board: Board, params: SearchParams = {}): SearchResult {
  const ts = params.query ? terms(params.query) : [];
  let hits = board.jobs.filter(matcher(board, params));

  hits =
    ts.length > 0
      ? hits.sort((a, b) => relevance(b, ts) - relevance(a, ts) || postedMs(b) - postedMs(a))
      : hits.sort((a, b) => postedMs(b) - postedMs(a));

  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const page = hits.slice(offset, offset + limit);

  return {
    generatedAt: board.generatedAt,
    total: hits.length,
    offset,
    returned: page.length,
    jobs: page,
  };
}

/* ------------------------------------------------------------------ detail */

/**
 * Descriptions are employer-authored text heading straight into an agent's
 * context, so they get a length cap. The cap is about tokens; the fact that
 * this text is untrusted is handled by the site serving plain text only, never
 * the HTML variant.
 */
export const MAX_DESCRIPTION_CHARS = 4000;

export function trimDescription(text: string | null, max = MAX_DESCRIPTION_CHARS): string | null {
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n\n[truncated — full advert at the apply URL]`;
}

export function describeJob(detail: JobDetail): JobDetail {
  return { ...detail, description: trimDescription(detail.description) };
}

/* ----------------------------------------------------------------- company */

export interface CompanyResult {
  generatedAt: string;
  company: string;
  companySlug: string;
  openRoles: number;
  jobs: McpJob[];
}

/** Accepts a slug or a display name — an agent that just read "Anthropic" off a
 *  search result shouldn't have to know the slug is "anthropic". */
export function getCompany(board: Board, nameOrSlug: string): CompanyResult | null {
  const needle = lower(nameOrSlug).trim();
  // An empty needle would match every company via the contains fallback below
  // ("".includes("") is true), and report the whole board as one employer.
  if (!needle) return null;
  const jobs = board.jobs.filter(
    (j) => lower(j.companySlug) === needle || lower(j.company) === needle,
  );
  // Fall back to a contains match so "shield" finds "Shield AI".
  const matched = jobs.length
    ? jobs
    : board.jobs.filter((j) => lower(j.company).includes(needle));
  if (!matched.length) return null;

  return {
    generatedAt: board.generatedAt,
    company: matched[0].company,
    companySlug: matched[0].companySlug,
    openRoles: matched.length,
    jobs: matched.sort((a, b) => postedMs(b) - postedMs(a)).slice(0, MAX_LIMIT),
  };
}

/* ------------------------------------------------------------------- stats */

export type StatsDimension =
  | "cluster"
  | "seniority"
  | "country"
  | "city"
  | "company"
  | "remote"
  | "skill";

export interface StatsBucket {
  key: string;
  jobs: number;
  /** Median annualised USD midpoint across the priced roles in this bucket. */
  medianSalaryUsd: number | null;
  pricedJobs: number;
}

export interface StatsResult {
  generatedAt: string;
  dimension: StatsDimension;
  totalJobs: number;
  pricedJobs: number;
  medianSalaryUsd: number | null;
  buckets: StatsBucket[];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

/** The dimensions where one job contributes to several buckets. */
function keysFor(j: McpJob, dimension: StatsDimension): string[] {
  switch (dimension) {
    case "cluster":
      return j.clusters;
    case "skill":
      return j.skills;
    case "seniority":
      return j.seniority ? [j.seniority] : [];
    case "country":
      return j.country ? [j.country] : [];
    case "city":
      return j.city ? [j.city] : [];
    case "company":
      return [j.company];
    case "remote":
      return j.remote ? [j.remote] : [];
  }
}

/**
 * The tool the search-shaped competition doesn't have. Aggregates over the
 * whole board rather than a page of results, so an agent can answer "what does
 * this market look like" instead of only "find me a job".
 *
 * Accepts the same filters as search, so the question can be scoped: median pay
 * by country *for staff-level RAG roles*, not just in general.
 */
export function boardStats(
  board: Board,
  dimension: StatsDimension,
  filters: SearchParams = {},
  topN = 20,
): StatsResult {
  // Aggregates run over every matching role, not a page of them — limit and
  // offset are search concerns and deliberately have no effect here.
  const all = board.jobs.filter(matcher(board, filters));

  const byKey = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const j of all) {
    for (const key of keysFor(j, dimension)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (j.salaryUsd != null) {
        const bucket = byKey.get(key) ?? [];
        bucket.push(j.salaryUsd);
        byKey.set(key, bucket);
      }
    }
  }

  const buckets: StatsBucket[] = [...counts.entries()]
    .map(([key, jobs]) => ({
      key,
      jobs,
      pricedJobs: byKey.get(key)?.length ?? 0,
      medianSalaryUsd: median(byKey.get(key) ?? []),
    }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, topN);

  const priced = all.map((j) => j.salaryUsd).filter((n): n is number => n != null);

  return {
    generatedAt: board.generatedAt,
    dimension,
    totalJobs: all.length,
    pricedJobs: priced.length,
    medianSalaryUsd: median(priced),
    buckets,
  };
}

/* ------------------------------------------------------------------ skills */

export interface SkillsResult {
  generatedAt: string;
  clusters: { id: string; label: string; skills: string[] }[];
  seniorities: string[];
  remoteTypes: string[];
}

/**
 * The controlled vocabulary. Without this an agent guesses at filter values —
 * "PyTorch" vs "pytorch", "ml-ops" vs "mlops" — and silently gets zero results
 * for a query that should have matched.
 */
export function listSkills(board: Board): SkillsResult {
  return {
    generatedAt: board.generatedAt,
    clusters: board.clusters,
    seniorities: ["intern", "junior", "mid", "senior", "staff", "principal", "lead", "manager"],
    remoteTypes: ["remote", "hybrid", "onsite"],
  };
}
