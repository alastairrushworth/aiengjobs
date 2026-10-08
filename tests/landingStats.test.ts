import { describe, expect, it } from "vitest";
import type { Job } from "@aiengjobs/shared";
import { computeLandingStats } from "../site/src/lib/landingStats.ts";

const GENERATED = "2026-10-08T05:00:00Z";
const daysAgo = (n: number) => new Date(Date.parse(GENERATED) - n * 86_400_000).toISOString();

function job(over: Partial<Job> & { slug: string }): Job {
  return {
    companyName: "Acme",
    companySlug: "acme",
    title: "AI Engineer",
    normalizedTitle: "ai engineer",
    applyUrl: "https://acme.test/apply",
    skills: [],
    clusters: [],
    ingestedAt: daysAgo(1),
    postedAt: daysAgo(1),
    ...over,
  } as Job;
}

const FX = { USD: 1 };

describe("computeLandingStats", () => {
  it("counts posting pace against the snapshot's clock", () => {
    const jobs = [
      job({ slug: "a", postedAt: daysAgo(2) }),
      job({ slug: "b", postedAt: daysAgo(6) }),
      job({ slug: "c", postedAt: daysAgo(20) }),
      job({ slug: "d", postedAt: daysAgo(45) }),
      job({ slug: "e", postedAt: undefined }),
    ];
    const s = computeLandingStats(jobs, FX, GENERATED);
    expect(s.total).toBe(5);
    expect(s.postedThisWeek).toBe(2);
    expect(s.postedLast30).toBe(3);
  });

  it("tallies levels in ladder order and drops empty ones", () => {
    const jobs = [
      job({ slug: "a", seniority: "staff" }),
      job({ slug: "b", seniority: "senior" }),
      job({ slug: "c", seniority: "senior" }),
      job({ slug: "d" }),
    ];
    const s = computeLandingStats(jobs, FX, GENERATED);
    expect(s.levels).toEqual([
      { name: "Senior", slug: "senior", count: 2 },
      { name: "Staff", slug: "staff", count: 1 },
    ]);
  });

  it("states a city's share of its country only when it is a proper part", () => {
    const jobs = [job({ slug: "a" }), job({ slug: "b" }), job({ slug: "c" })];
    const part = computeLandingStats(jobs, FX, GENERATED, {
      country: { name: "United Kingdom", total: 12 },
    });
    expect(part.countryShare).toEqual({ name: "United Kingdom", total: 12, pct: 25 });

    // A city that is the whole of its country's hiring has nothing to compare to.
    const whole = computeLandingStats(jobs, FX, GENERATED, {
      country: { name: "Iceland", total: 3 },
    });
    expect(whole.countryShare).toBeNull();
    expect(computeLandingStats(jobs, FX, GENERATED).countryShare).toBeNull();
  });

  it("carries the board median through and withholds its own below five priced roles", () => {
    const priced = (slug: string, mid: number) =>
      job({ slug, salaryMin: mid, salaryMax: mid, salaryCurrency: "USD", salaryPeriod: "year" });
    const four = [priced("a", 100e3), priced("b", 110e3), priced("c", 120e3), priced("d", 130e3)];
    expect(computeLandingStats(four, FX, GENERATED, { boardMedianUsd: 197e3 })).toMatchObject({
      pricedCount: 4,
      medianUsd: null,
      boardMedianUsd: 197e3,
    });
    const five = [...four, priced("e", 140e3)];
    expect(computeLandingStats(five, FX, GENERATED).medianUsd).toBe(120e3);
    expect(computeLandingStats(five, FX, GENERATED).boardMedianUsd).toBeNull();
  });
});
