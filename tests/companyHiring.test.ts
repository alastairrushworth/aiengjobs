import { describe, expect, it } from "vitest";
import type { Job } from "@aiengjobs/shared";
import {
  MIN_PRICED_FOR_COMPANY_MEDIAN,
  sharePct,
  summarizeCompanyHiring,
} from "../site/src/lib/companyHiring.ts";

const NOW = "2026-09-17T00:00:00Z";
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
  postedAt: "2026-09-10T00:00:00Z",
  ...over,
});

const summarize = (jobs: Job[], hiring?: Parameters<typeof summarizeCompanyHiring>[1], board?: { closedRoles: number; medianDaysOpen?: number }) =>
  summarizeCompanyHiring(jobs, hiring, board, NOW, {});

describe("summarizeCompanyHiring", () => {
  it("counts what was posted recently against the snapshot's clock, not the machine's", () => {
    const s = summarize([
      job({ postedAt: "2026-09-16T00:00:00Z" }),
      job({ postedAt: "2026-08-18T00:00:01Z" }), // 29.99 days
      job({ postedAt: "2026-08-01T00:00:00Z" }),
      job({ postedAt: undefined }),
    ]);
    expect(s.openRoles).toBe(4);
    expect(s.postedRecently).toBe(2);
  });

  it("quotes a median only once enough roles publish pay, but the range from the first", () => {
    const priced = (k: number) => job({ salaryMin: k, salaryMax: k + 20_000 });
    const two = summarize([priced(100_000), priced(200_000)]);
    expect(two.pricedCount).toBe(2);
    expect(two.medianUsd).toBeNull();
    expect(two.payRangeUsd).toEqual({ lo: 100_000, hi: 220_000 });

    const three = summarize(Array.from({ length: MIN_PRICED_FOR_COMPANY_MEDIAN }, (_, i) => priced(100_000 + i * 50_000)));
    expect(three.medianUsd).toBe(160_000);
  });

  it("keeps remote roles off the map", () => {
    const s = summarize([
      job({ city: "London", country: "GB", remoteType: "hybrid" }),
      job({ city: "London", country: "GB", remoteType: "onsite" }),
      job({ city: "San Francisco", country: "US", remoteType: "remote" }),
      job({ country: "DE", remoteType: "onsite" }),
    ]);
    expect(s.locations).toEqual([
      { label: "London", count: 2 },
      { label: "Germany", count: 1 },
    ]);
    expect(s.remoteCount).toBe(1);
  });

  it("lists levels in ladder order, not by frequency", () => {
    const s = summarize([job({ seniority: "staff" }), job({ seniority: "staff" }), job({ seniority: "senior" })]);
    expect(s.levels).toEqual([
      { label: "Senior", count: 1 },
      { label: "Staff", count: 2 },
    ]);
  });

  it("links clusters to their landing pages", () => {
    const s = summarize([job({ clusters: ["agents", "rag"] }), job({ clusters: ["agents"] })]);
    expect(s.clusters[0]).toMatchObject({ slug: "ai-agent-jobs", count: 2 });
  });

  it("turns the engine's total into a share of the employer's hiring", () => {
    const s = summarize([job(), job()], { hiring: { openPostings: 10, closedRoles: 0 } });
    expect(s.scopeShare).toBe(0.2);
    expect(s.openPostings).toBe(10);
  });

  it("refuses a share above 100% rather than publishing it", () => {
    // The engine counted before two roles were listed, or under different rules.
    const s = summarize([job(), job(), job()], { hiring: { openPostings: 2, closedRoles: 0 } });
    expect(s.scopeShare).toBeUndefined();
    expect(s.openPostings).toBeUndefined();
  });

  it("carries the closing time and the board's, when the engine supplies them", () => {
    const s = summarize([job()], { hiring: { closedRoles: 9, medianDaysOpen: 34 } }, { closedRoles: 3000, medianDaysOpen: 54 });
    expect(s).toMatchObject({ closedRoles: 9, medianDaysOpen: 34, boardMedianDaysOpen: 54 });
  });

  it("works on a snapshot that predates the hiring fields", () => {
    const s = summarize([job()], {}, undefined);
    expect(s.scopeShare).toBeUndefined();
    expect(s.medianDaysOpen).toBeUndefined();
    expect(s.boardMedianDaysOpen).toBeUndefined();
  });
});

describe("sharePct", () => {
  it("never rounds a real share down to nothing", () => {
    expect(sharePct(0.214)).toBe("21%");
    expect(sharePct(0.004)).toBe("<1%");
  });
});
