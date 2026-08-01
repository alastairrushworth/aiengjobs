/**
 * Access to the board data, and nothing else.
 *
 * Deliberately free of MCP types, Node built-ins and filesystem access: the
 * whole point of splitting this out is that the same module backs the stdio
 * server today and a Cloudflare Worker later, where `fs` doesn't exist and the
 * only cache is the isolate's own memory.
 *
 * The site is the source of truth. This never holds a copy of the corpus, it
 * fetches the file the nightly build publishes, so the server has no data to
 * deploy and can't go stale independently of the board.
 */

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
  /** Annualised midpoint in USD, precomputed by the site. Null when unpriced. */
  salaryUsd: number | null;
  skills: string[];
  clusters: string[];
  postedAt: string | null;
}

export interface JobDetail extends McpJob {
  /** Snapshot date, carried on the per-job file too so a detail response can
   *  date itself without a second fetch of the index. */
  generatedAt: string;
  description: string | null;
  companyDomain: string | null;
  companyDescription: string | null;
  jobUrl: string;
}

export interface Cluster {
  id: string;
  label: string;
  skills: string[];
}

export interface Board {
  generatedAt: string;
  jobCount: number;
  clusters: Cluster[];
  fxRates: Record<string, number>;
  jobs: McpJob[];
}

const DEFAULT_BASE = "https://frontierroles.com";

let configuredBase: string | null = null;

/**
 * Point the server at a different site.
 *
 * Workers have no `process.env` — configuration arrives as a binding on the
 * request, so the entry point calls this rather than the module reading the
 * environment for itself. stdio keeps using the env var.
 */
export function configure(opts: { baseUrl?: string }): void {
  if (opts.baseUrl) configuredBase = opts.baseUrl.replace(/\/$/, "");
}

export function baseUrl(): string {
  if (configuredBase) return configuredBase;
  return (globalThis.process?.env?.FRONTIERROLES_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
}

/**
 * One hour. The board is rebuilt nightly, so this is not about freshness so
 * much as about a long-lived stdio process not pinning a week-old copy of the
 * index in memory. Revalidation is conditional, so the usual cost of a refresh
 * is a 304 and no body.
 */
const TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  board: Board;
  etag: string | null;
  fetchedAt: number;
}

let cached: CacheEntry | null = null;
/** Collapses concurrent first-loads into one fetch rather than N. */
let inFlight: Promise<Board> | null = null;

function isFresh(entry: CacheEntry, now: number): boolean {
  return now - entry.fetchedAt < TTL_MS;
}

async function fetchBoard(previous: CacheEntry | null): Promise<Board> {
  const headers: Record<string, string> = {};
  if (previous?.etag) headers["If-None-Match"] = previous.etag;

  const res = await fetch(`${baseUrl()}/mcp-index.json`, { headers });

  // Nothing changed — keep the parsed copy and reset its clock. This is the
  // common path on revalidation and costs no parse and no body transfer.
  if (res.status === 304 && previous) {
    previous.fetchedAt = Date.now();
    return previous.board;
  }

  if (!res.ok) {
    // A stale board beats no board: if the site is briefly unreachable, an
    // agent mid-task should get slightly old data with a date attached rather
    // than a hard failure.
    if (previous) {
      previous.fetchedAt = Date.now();
      return previous.board;
    }
    throw new Error(`Could not load the job index from ${baseUrl()} (HTTP ${res.status}).`);
  }

  const board = (await res.json()) as Board;
  if (!board || !Array.isArray(board.jobs) || !board.generatedAt) {
    throw new Error("The job index came back in an unexpected shape.");
  }

  cached = { board, etag: res.headers.get("etag"), fetchedAt: Date.now() };
  return board;
}

/** The whole board, cached in memory and revalidated with an ETag. */
export async function loadBoard(): Promise<Board> {
  const now = Date.now();
  if (cached && isFresh(cached, now)) return cached.board;
  if (inFlight) return inFlight;

  inFlight = fetchBoard(cached).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * One role, with its description. Fetched on demand — descriptions average 6KB
 * and are 95% of the corpus by size, so pulling them per-search would cost an
 * agent roughly fifteen times the tokens for data it mostly won't read.
 *
 * Returns null for an unknown slug, which is also how a closed or aged-out role
 * reports itself: those drop out of the published set, so a 404 here is a real
 * signal that the role is gone rather than an error to retry.
 */
export async function loadJob(slug: string): Promise<JobDetail | null> {
  const res = await fetch(`${baseUrl()}/mcp-jobs/${encodeURIComponent(slug)}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load job "${slug}" (HTTP ${res.status}).`);
  return (await res.json()) as JobDetail;
}

/** Test seam — drops the memoized board so a test can swap the base URL. */
export function resetCache(): void {
  cached = null;
  inFlight = null;
  configuredBase = null;
}
