import type { Job } from "@aiengjobs/shared";
import { fxRates, openJobs } from "./data.ts";
import { buildPayPools, payBenchmark, type PayBenchmark } from "./payBenchmark.ts";

/**
 * lib/payBenchmark bound to the live board.
 *
 * The arithmetic lives in payBenchmark.ts, which takes its roles as an argument
 * and so can be tested; this module is the one line that hands it the snapshot.
 * Pools are built once per build, over the listed roles — the comparison is
 * with what a reader could apply to today, not with roles that have closed.
 */
const pools = buildPayPools(openJobs, fxRates);

export function payContext(job: Job): PayBenchmark | null {
  return payBenchmark(job, pools, fxRates);
}

export { IN_LINE_BAND, payChart } from "./payBenchmark.ts";
export type { PayBenchmark, PayChart } from "./payBenchmark.ts";
