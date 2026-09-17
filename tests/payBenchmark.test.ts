import { describe, expect, it } from "vitest";
import type { Job } from "@aiengjobs/shared";
import {
  MIN_PRICED_FOR_COMPARISON,
  MIN_PRICED_FOR_SENIORITY,
  buildPayPools,
  payBenchmark,
  payChart,
  quantile,
} from "../site/src/lib/payBenchmark.ts";

let n = 0;
const job = (over: Partial<Job> = {}): Job => ({
  slug: `job-${n++}`,
  companyName: "Co",
  companySlug: "co",
  title: "AI Engineer",
  normalizedTitle: "ai engineer",
  applyUrl: "https://x/apply",
  skills: [],
  clusters: ["agents"],
  ingestedAt: "2026-09-01T00:00:00Z",
  country: "US",
  ...over,
});

/** `count` roles paying 100k, 110k, 120k… so every quantile is easy to read off. */
const ladder = (count: number, over: Partial<Job> = {}): Job[] =>
  Array.from({ length: count }, (_, i) =>
    job({ salaryMin: 100_000 + i * 10_000, salaryMax: 100_000 + i * 10_000, ...over }),
  );

describe("quantile", () => {
  it("interpolates between neighbours", () => {
    expect(quantile([100, 200, 300, 400, 500], 0.5)).toBe(300);
    expect(quantile([100, 200, 300, 400], 0.5)).toBe(250);
    expect(quantile([100, 200], 0.25)).toBe(125);
  });
});

describe("payBenchmark", () => {
  it("stays silent until a pool has enough priced roles to mean something", () => {
    const thin = ladder(MIN_PRICED_FOR_COMPARISON - 1);
    expect(payBenchmark(thin[0]!, buildPayPools(thin, {}), {})).toBeNull();
    const enough = ladder(MIN_PRICED_FOR_COMPARISON);
    expect(payBenchmark(enough[0]!, buildPayPools(enough, {}), {})).not.toBeNull();
  });

  it("describes the spread, not just the middle", () => {
    const jobs = ladder(11); // 100k … 200k
    const b = payBenchmark(jobs[0]!, buildPayPools(jobs, {}), {})!;
    expect(b.pricedCount).toBe(11);
    expect([b.p10, b.p25, b.medianUsd, b.p75, b.p90]).toEqual([110_000, 125_000, 150_000, 175_000, 190_000]);
  });

  it("places a priced role by how many of the others it out-pays", () => {
    const jobs = ladder(11);
    const b = payBenchmark(jobs[8]!, buildPayPools(jobs, {}), {})!; // 180k
    expect(b.role?.below).toBe(8);
    expect(b.role?.delta).toBeCloseTo(0.2);
  });

  it("still benchmarks a role that publishes nothing — the case it exists for", () => {
    const unpriced = job();
    const jobs = [...ladder(10), unpriced];
    const b = payBenchmark(unpriced, buildPayPools(jobs, {}), {})!;
    expect(b.role).toBeUndefined();
    expect(b.total).toBe(11);
    expect(b.pricedCount).toBe(10);
  });

  it("prefers the role's own country over the worldwide pool", () => {
    const us = ladder(10, { country: "US" });
    const india = ladder(10, { country: "IN" }).map((j) => ({ ...j, salaryMin: 30_000, salaryMax: 30_000 }));
    const b = payBenchmark(us[0]!, buildPayPools([...us, ...india], {}), {})!;
    expect(b.country).toBe("the United States");
    expect(b.pricedCount).toBe(10);
  });

  it("narrows to the role's level only when that level has the evidence", () => {
    const seniors = ladder(MIN_PRICED_FOR_SENIORITY, { seniority: "senior" });
    const staff = ladder(MIN_PRICED_FOR_SENIORITY - 1, { seniority: "staff" });
    const pools = buildPayPools([...seniors, ...staff], {});
    expect(payBenchmark(seniors[0]!, pools, {})!.seniority).toBe("Senior");
    // One short of the bar: fall back to every level in the country.
    const fallback = payBenchmark(staff[0]!, pools, {})!;
    expect(fallback.seniority).toBeNull();
    expect(fallback.pricedCount).toBe(2 * MIN_PRICED_FOR_SENIORITY - 1);
  });

  it("falls back to the worldwide pool when the country is too thin", () => {
    const lone = job({ country: "PT", salaryMin: 90_000, salaryMax: 90_000 });
    const b = payBenchmark(lone, buildPayPools([...ladder(10), lone], {}), {})!;
    expect(b.country).toBeNull();
    // …and says so: a Lisbon role set against mostly-US pay needs the caveat.
    expect(b.tooThinIn).toBe("Portugal");
  });

  it("raises no caveat when the comparison is local, or the role has no country", () => {
    const us = ladder(10);
    expect(payBenchmark(us[0]!, buildPayPools(us, {}), {})!.tooThinIn).toBeNull();
    const nowhere = ladder(10, { country: undefined });
    expect(payBenchmark(nowhere[0]!, buildPayPools(nowhere, {}), {})!.tooThinIn).toBeNull();
  });

  it("measures a role with no cluster against the whole board", () => {
    // 8% of listed roles carry no cluster; a Staff role publishing $320k–$485k
    // used to show no comparison at all for want of a tag.
    const jobs = ladder(10, { clusters: [] });
    const b = payBenchmark(jobs[0]!, buildPayPools(jobs, {}), {})!;
    expect(b.clusterSlug).toBeNull();
    expect(b.clusterLabel).toBe("AI-engineering");
    expect(b.pricedCount).toBe(10);
  });

  it("never links to a cluster that has no landing page", () => {
    const jobs = ladder(10, { clusters: ["not-a-cluster" as never] });
    expect(payBenchmark(jobs[0]!, buildPayPools(jobs, {}), {})!.clusterSlug).toBeNull();
  });

  it("prefers the whole board in the role's country to its cluster worldwide", () => {
    const berlin = job({ country: "DE", clusters: ["agents"], salaryMin: 90_000, salaryMax: 90_000 });
    const germany = ladder(10, { country: "DE", clusters: ["rag"] });
    const agentsElsewhere = ladder(10, { country: "US", clusters: ["agents"] });
    const b = payBenchmark(berlin, buildPayPools([berlin, ...germany, ...agentsElsewhere], {}), {})!;
    expect(b.country).toBe("Germany");
    expect(b.clusterSlug).toBeNull();
  });

  it("prefers the cluster's pool when both clear the bar at the same tier", () => {
    const jobs = [...ladder(10, { clusters: ["agents"] }), ...ladder(30, { clusters: ["rag"] })];
    expect(payBenchmark(jobs[0]!, buildPayPools(jobs, {}), {})!.clusterSlug).toBe("ai-agent-jobs");
  });
});

describe("payChart", () => {
  const jobs = ladder(11);
  const pools = buildPayPools(jobs, {});

  it("runs the axis from the 10th to the 90th percentile when the role sits inside it", () => {
    const c = payChart(payBenchmark(jobs[5]!, pools, {})!);
    expect([c.minUsd, c.maxUsd]).toEqual([110_000, 190_000]);
    expect(c.whisker).toEqual({ left: 0, width: 100 });
    expect(c.median).toBe(50);
    expect(c.labelMedian).toBe(true);
  });

  it("stretches the axis rather than clipping a role that pays past the 90th percentile", () => {
    const rich = job({ salaryMin: 300_000, salaryMax: 400_000 });
    const c = payChart(payBenchmark(rich, buildPayPools([...jobs, rich], {}), {})!);
    expect(c.maxUsd).toBe(400_000);
    expect(c.role!.left + c.role!.width).toBeCloseTo(100);
    expect(c.whisker.width).toBeLessThan(40);
  });

  it("drops the median label when it would collide with an end label", () => {
    const rich = job({ salaryMin: 900_000, salaryMax: 1_000_000 });
    const c = payChart(payBenchmark(rich, buildPayPools([...jobs, rich], {}), {})!);
    expect(c.labelMedian).toBe(false);
  });

  it("draws a single published figure as a point", () => {
    const c = payChart(payBenchmark(jobs[3]!, pools, {})!);
    expect(c.role!.width).toBe(0);
  });
});
