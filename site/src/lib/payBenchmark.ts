import type { Job, Seniority } from "@aiengjobs/shared";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";
import { CLUSTER_PAGES } from "./clusters.ts";
import { countryName, salaryMidpointUsd, salaryRangeUsd, seniorityLabel } from "./format.ts";

/**
 * Where a role's pay sits against the rest of the board.
 *
 * The description on a job page is the employer's, and Google already has it
 * from the employer. What the board knows that the employer's page does not is
 * the other few thousand roles: what a senior agents role in the United States
 * with a published range actually pays, how wide that spread is, and how many
 * publish one at all. For the half of the board that publishes no pay this is
 * the only pay information on the page — which is where it earns its keep.
 *
 * Pure: pools are built from whatever roles it is handed, so the arithmetic can
 * be tested without the 40MB snapshot. lib/payContext.ts binds it to the live
 * board.
 */

/** Priced roles a pool needs before it is quoted. */
export const MIN_PRICED_FOR_COMPARISON = 8;

/**
 * A pool narrowed to one seniority needs more than the bare minimum: it is the
 * tier that replaces a perfectly good country-wide pool, and quartiles over
 * eight roles move when one of them closes.
 */
export const MIN_PRICED_FOR_SENIORITY = 12;

/** Below this share of the median either way, pay is reported as "in line". */
export const IN_LINE_BAND = 0.05;

export interface PayPool {
  /** Null for every role on the board, whatever it is filed under. */
  cluster: ClusterId | null;
  /** ISO country, or null for the cluster across every country. */
  country: string | null;
  /** Null for every level together. */
  seniority: Seniority | null;
  total: number;
  /** USD midpoints of the priced roles, ascending. */
  mids: number[];
}

export interface PayBenchmark {
  /** Cluster page the comparison links to; null when the pool is the whole board. */
  clusterSlug: string | null;
  /** "AI Agents", or "AI-engineering" for the whole board — ready to precede "roles". */
  clusterLabel: string;
  /** Readable country the pool was narrowed to, ready to follow "in", or null when worldwide. */
  country: string | null;
  /** "Senior", "Staff"… when the pool was narrowed to this role's level. */
  seniority: string | null;
  /**
   * The role's own country, ready to follow "in", when the comparison had to
   * fall back past it to the whole world. The pool is then mostly US roles, and
   * a Munich role set against a $255k median needs to be told so.
   */
  tooThinIn: string | null;
  total: number;
  pricedCount: number;
  p10: number;
  p25: number;
  medianUsd: number;
  p75: number;
  p90: number;
  /** Present only when this role publishes a usable range. */
  role?: {
    loUsd: number;
    hiUsd: number;
    midUsd: number;
    /** Midpoint relative to the pool median (+0.12 = 12% above). */
    delta: number;
    /** Priced roles in the pool whose midpoint is below this one's. */
    below: number;
  };
}

const poolKey = (cluster: ClusterId | null, country: string | null, seniority: Seniority | null) =>
  `${cluster ?? "*"}|${country ?? "*"}|${seniority ?? "*"}`;

/**
 * Every role joins the worldwide pool of each of its clusters, and of the board
 * as a whole; one with a country joins that country's pools too, and one with a
 * level joins the level-specific version of each.
 *
 * The whole-board pools are what a role with no cluster is measured against —
 * 8% of listed roles carry none, and a Staff role publishing $320k–$485k showed
 * no comparison at all for want of a tag.
 */
export function buildPayPools(jobs: Job[], fxRates: Record<string, number>): Map<string, PayPool> {
  const pools = new Map<string, PayPool>();
  for (const job of jobs) {
    const mid = salaryMidpointUsd(job, fxRates);
    const countries: (string | null)[] = job.country ? [null, job.country] : [null];
    const levels: (Seniority | null)[] = job.seniority ? [null, job.seniority] : [null];
    for (const cluster of [...job.clusters, null]) {
      for (const country of countries) {
        for (const seniority of levels) {
          const key = poolKey(cluster, country, seniority);
          let pool = pools.get(key);
          if (!pool) {
            pool = { cluster, country, seniority, total: 0, mids: [] };
            pools.set(key, pool);
          }
          pool.total++;
          if (mid !== null) pool.mids.push(mid);
        }
      }
    }
  }
  for (const pool of pools.values()) pool.mids.sort((a, b) => a - b);
  return pools;
}

/** Linear-interpolated quantile of an ascending array. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
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
 * The pool a role is compared against, most specific first: its country and
 * level, then its country, then its level worldwide, then worldwide. Country
 * outranks level because it moves pay further — the same title pays several
 * times more in San Francisco than in Bengaluru, while a level is a step of
 * tens of percent.
 *
 * Within a tier a cluster's pool beats the whole board's, and of the role's
 * clusters the one with the most priced roles wins: the comparison should rest
 * on the richest evidence the board has, not on whichever cluster was tagged
 * first. But the tier comes first — "every AI-engineering role in Germany" says
 * more about a Berlin agents role's pay than "agents roles worldwide" does.
 */
export function payBenchmark(
  job: Job,
  pools: ReadonlyMap<string, PayPool>,
  fxRates: Record<string, number>,
): PayBenchmark | null {
  // Tier, then cluster-specific over whole-board, then evidence.
  const rank = (p: PayPool) =>
    ((p.country ? 2 : 0) + (p.seniority ? 1 : 0)) * 10_000_000 +
    (p.cluster ? 1_000_000 : 0) +
    p.mids.length;
  let best: PayPool | null = null;
  for (const cluster of [...job.clusters, null]) {
    if (cluster && !clusterPage.has(cluster)) continue;
    for (const country of [job.country ?? null, null]) {
      for (const seniority of [job.seniority ?? null, null]) {
        const pool = pools.get(poolKey(cluster, country, seniority));
        if (!pool) continue;
        const min = seniority ? MIN_PRICED_FOR_SENIORITY : MIN_PRICED_FOR_COMPARISON;
        if (pool.mids.length < min) continue;
        if (!best || rank(pool) > rank(best)) best = pool;
      }
    }
  }
  if (!best) return null;

  const page = best.cluster ? clusterPage.get(best.cluster)! : null;
  const medianUsd = quantile(best.mids, 0.5);
  const range = salaryRangeUsd(job, fxRates);
  const mid = salaryMidpointUsd(job, fxRates);
  return {
    clusterSlug: page?.slug ?? null,
    clusterLabel: page?.label ?? "AI-engineering",
    country: best.country ? inPhrase(countryName(best.country) ?? best.country) : null,
    seniority: best.seniority ? seniorityLabel(best.seniority) : null,
    tooThinIn:
      !best.country && job.country ? inPhrase(countryName(job.country) ?? job.country) : null,
    total: best.total,
    pricedCount: best.mids.length,
    p10: quantile(best.mids, 0.1),
    p25: quantile(best.mids, 0.25),
    medianUsd,
    p75: quantile(best.mids, 0.75),
    p90: quantile(best.mids, 0.9),
    ...(range && mid !== null && medianUsd > 0
      ? {
          role: {
            loUsd: range.lo,
            hiUsd: range.hi,
            midUsd: mid,
            delta: mid / medianUsd - 1,
            below: best.mids.filter((m) => m < mid).length,
          },
        }
      : {}),
  };
}

/** One positioned mark on the strip chart, as percentages of its width. */
export interface ChartSpan {
  left: number;
  width: number;
}

export interface PayChart {
  /** 10th–90th percentile of the pool. */
  whisker: ChartSpan;
  /** Middle half of the pool. */
  box: ChartSpan;
  median: number;
  /** This role's range; width 0 when it publishes a single figure. */
  role?: ChartSpan;
  /** The values at the two ends of the axis. */
  minUsd: number;
  maxUsd: number;
  /** Whether the median has room for its own label between the end labels. */
  labelMedian: boolean;
}

/**
 * Share of the chart's width the median label needs clear on either side. Set
 * by the narrowest chart, not the widest: on a 390px phone the axis is ~260px,
 * an end label is ~32px and the centred median label another ~18px, so anything
 * under a fifth of the way along prints "$200k$257k".
 */
const LABEL_CLEARANCE_PCT = 22;

/**
 * Geometry for the strip chart, as percentages so the markup needs no script
 * and no fixed width. The axis runs from the pool's 10th to its 90th
 * percentile, stretched to take in the role's own range when that falls
 * outside — a role paying past the 90th percentile is the interesting case and
 * must not be clipped to look ordinary.
 */
export function payChart(b: PayBenchmark): PayChart {
  const minUsd = Math.min(b.p10, b.role?.loUsd ?? Infinity);
  const maxUsd = Math.max(b.p90, b.role?.hiUsd ?? -Infinity);
  const span = maxUsd - minUsd || 1;
  const at = (v: number) => ((v - minUsd) / span) * 100;
  const between = (lo: number, hi: number): ChartSpan => ({ left: at(lo), width: at(hi) - at(lo) });
  const median = at(b.medianUsd);
  return {
    whisker: between(b.p10, b.p90),
    box: between(b.p25, b.p75),
    median,
    ...(b.role ? { role: between(b.role.loUsd, b.role.hiUsd) } : {}),
    minUsd,
    maxUsd,
    labelMedian: median >= LABEL_CLEARANCE_PCT && median <= 100 - LABEL_CLEARANCE_PCT,
  };
}
