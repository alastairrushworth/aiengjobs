import type { Job } from "@aiengjobs/shared";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";
import { CLUSTER_PAGES } from "./clusters.ts";
import { fxRates, openJobs } from "./data.ts";
import { countryName, median, salaryMidpointUsd } from "./format.ts";

/**
 * Where a role's pay sits against the rest of the board.
 *
 * The description on a job page is the employer's, and Google already has it
 * from the employer. What the board knows that the employer's page does not is
 * the other few thousand roles: what an agents role in the United States with
 * a published range actually pays, and how many publish one at all. That is
 * the one sentence on the page that is ours, so it is computed from the live
 * snapshot rather than written once — and it is only said when there are
 * enough priced roles for a median to mean something.
 */

/** Priced roles a pool needs before its median is quoted. */
export const MIN_PRICED_FOR_COMPARISON = 8;

/** Below this share of the median either way, pay is reported as "in line". */
export const IN_LINE_BAND = 0.05;

interface Pool {
  cluster: ClusterId;
  /** ISO country, or null for the cluster across every country. */
  country: string | null;
  total: number;
  mids: number[];
}

export interface PayContext {
  /** Cluster page the comparison links to. */
  clusterSlug: string;
  clusterLabel: string;
  /** Readable country the pool was narrowed to, ready to follow "in", or null when worldwide. */
  country: string | null;
  total: number;
  pricedCount: number;
  medianUsd: number;
  /** This role's midpoint relative to the median (+0.12 = 12% above); absent when unpriced. */
  delta?: number;
}

const poolKey = (cluster: ClusterId, country: string | null) => `${cluster}|${country ?? "*"}`;

// Built once per build, over the listed roles. Every role joins the worldwide
// pool of each of its clusters; a role with a country joins that country's
// pool too.
const pools = new Map<string, Pool>();
for (const job of openJobs) {
  const mid = salaryMidpointUsd(job, fxRates);
  const countries: (string | null)[] = job.country ? [null, job.country] : [null];
  for (const cluster of job.clusters) {
    for (const country of countries) {
      const key = poolKey(cluster, country);
      let pool = pools.get(key);
      if (!pool) {
        pool = { cluster, country, total: 0, mids: [] };
        pools.set(key, pool);
      }
      pool.total++;
      if (mid !== null) pool.mids.push(mid);
    }
  }
}

const clusterPage = new Map(CLUSTER_PAGES.map((p) => [p.id, p]));

/** Country names that read wrongly without an article: "in the United States". */
const TAKES_THE: ReadonlySet<string> = new Set([
  "United States",
  "United Kingdom",
  "Netherlands",
  "United Arab Emirates",
  "Philippines",
  "Czech Republic",
]);

/** "United States" → "the United States"; everything else as-is. */
const inPhrase = (name: string): string => (TAKES_THE.has(name) ? `the ${name}` : name);

/**
 * The pool a role is compared against: its own country first, the cluster
 * worldwide when the country is too thin to quote. Of the role's clusters, the
 * one with the most priced roles — the comparison should rest on the richest
 * evidence the board has, not on whichever cluster happened to be tagged first.
 */
export function payContext(job: Job): PayContext | null {
  // Specificity first, then evidence: any country pool that clears the bar
  // beats any worldwide one, and among equals the one with more priced roles.
  const rank = (p: Pool) => (p.country ? 1_000_000 : 0) + p.mids.length;
  let best: Pool | null = null;
  for (const cluster of job.clusters) {
    if (!clusterPage.has(cluster)) continue;
    for (const country of [job.country ?? null, null]) {
      const pool = pools.get(poolKey(cluster, country));
      if (!pool || pool.mids.length < MIN_PRICED_FOR_COMPARISON) continue;
      if (!best || rank(pool) > rank(best)) best = pool;
    }
  }
  if (!best) return null;

  const page = clusterPage.get(best.cluster)!;
  const medianUsd = median(best.mids);
  const mid = salaryMidpointUsd(job, fxRates);
  return {
    clusterSlug: page.slug,
    clusterLabel: page.label,
    country: best.country ? inPhrase(countryName(best.country) ?? best.country) : null,
    total: best.total,
    pricedCount: best.mids.length,
    medianUsd,
    ...(mid !== null && medianUsd > 0 ? { delta: mid / medianUsd - 1 } : {}),
  };
}
