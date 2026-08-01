import { describe, expect, it } from "vitest";
import type { Board, McpJob } from "../mcp/src/board.ts";
import {
  SENIOR_PLUS,
  boardStats,
  getCompany,
  listSkills,
  searchJobs,
  trimDescription,
} from "../mcp/src/tools.ts";

/**
 * The MCP tools are the whole product surface for an agent: it can't see the
 * site, only what these functions return. A filter that silently matches
 * nothing looks identical to an empty board from the other side, so most of
 * what follows is about the ways a filter can be quietly wrong rather than
 * loudly broken.
 */

const GENERATED_AT = "2026-07-31T04:00:00.000Z";
const daysBefore = (n: number) =>
  new Date(Date.parse(GENERATED_AT) - n * 86_400_000).toISOString();

let n = 0;
function job(over: Partial<McpJob> = {}): McpJob {
  n += 1;
  return {
    slug: `job-${n}`,
    title: "AI Engineer",
    company: "Acme",
    companySlug: "acme",
    applyUrl: "https://example.com/apply",
    location: "London, UK",
    country: "GB",
    city: "London",
    remote: "onsite",
    seniority: "mid",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryUsd: null,
    skills: [],
    clusters: [],
    postedAt: daysBefore(1),
    ...over,
  };
}

function board(jobs: McpJob[]): Board {
  return {
    generatedAt: GENERATED_AT,
    jobCount: jobs.length,
    clusters: [
      { id: "rag", label: "Retrieval / RAG", skills: ["RAG", "Pinecone"] },
      { id: "agents", label: "Agents", skills: ["LangChain"] },
    ],
    fxRates: { USD: 1, GBP: 1.27 },
    jobs,
  };
}

describe("searchJobs — free text", () => {
  it("requires every term but not in order", () => {
    const b = board([
      job({ title: "Senior RAG Engineer" }),
      job({ title: "RAG Platform Lead", seniority: "lead" }),
    ]);
    // The trap this guards: compiling the query to one regex and testing it
    // against the job's fields concatenated. That makes terms positional, and
    // "senior rag" then matches nothing on a board full of senior RAG roles.
    expect(searchJobs(b, { query: "rag senior" }).total).toBe(1);
    expect(searchJobs(b, { query: "senior rag" }).total).toBe(1);
  });

  it("matches across fields, not just the title", () => {
    const b = board([job({ company: "Pinecone", title: "Backend Engineer" })]);
    expect(searchJobs(b, { query: "pinecone backend" }).total).toBe(1);
  });

  it("ranks title hits above incidental ones", () => {
    const b = board([
      job({ slug: "incidental", title: "Backend Engineer", skills: ["RAG"] }),
      job({ slug: "in-title", title: "RAG Engineer" }),
    ]);
    expect(searchJobs(b, { query: "rag" }).jobs[0].slug).toBe("in-title");
  });

  it("is case-insensitive", () => {
    const b = board([job({ title: "Staff ML Engineer" })]);
    expect(searchJobs(b, { query: "STAFF ml" }).total).toBe(1);
  });
});

describe("searchJobs — filters", () => {
  it("requires all skills but any cluster", () => {
    const b = board([
      job({ slug: "both", skills: ["RAG", "Pinecone"], clusters: ["rag"] }),
      job({ slug: "one", skills: ["RAG"], clusters: ["agents"] }),
    ]);
    expect(searchJobs(b, { skills: ["RAG", "Pinecone"] }).total).toBe(1);
    expect(searchJobs(b, { clusters: ["rag", "agents"] }).total).toBe(2);
  });

  it("treats senior+ as the whole band", () => {
    const b = board([
      job({ seniority: "junior" }),
      job({ seniority: "senior" }),
      job({ seniority: "staff" }),
      job({ seniority: "principal" }),
    ]);
    expect(searchJobs(b, { seniority: SENIOR_PLUS }).total).toBe(3);
    expect(searchJobs(b, { seniority: "senior" }).total).toBe(1);
  });

  it("excludes unpriced roles from a pay floor rather than treating them as zero", () => {
    const b = board([
      job({ slug: "priced", salaryUsd: 200_000 }),
      job({ slug: "unpriced", salaryUsd: null }),
    ]);
    const hits = searchJobs(b, { salaryMinUsd: 150_000 });
    expect(hits.jobs.map((j) => j.slug)).toEqual(["priced"]);
  });

  it("measures posting age against the snapshot, not wall-clock now", () => {
    // The board is a nightly export. If this used Date.now(), "posted in the
    // last 7 days" would quietly return fewer roles the older the snapshot got,
    // and nothing would look broken — just a board that seemed to stop hiring.
    const b = board([
      job({ slug: "fresh", postedAt: daysBefore(3) }),
      job({ slug: "old", postedAt: daysBefore(30) }),
    ]);
    const hits = searchJobs(b, { postedWithinDays: 7 });
    expect(hits.jobs.map((j) => j.slug)).toEqual(["fresh"]);
  });

  it("matches company as a substring but country exactly", () => {
    const b = board([job({ company: "Shield AI", country: "US" })]);
    expect(searchJobs(b, { company: "shield" }).total).toBe(1);
    expect(searchJobs(b, { country: "us" }).total).toBe(1);
    expect(searchJobs(b, { country: "U" }).total).toBe(0);
  });
});

describe("searchJobs — paging", () => {
  it("defaults to 20 and caps at 50 however much is asked for", () => {
    const b = board(Array.from({ length: 80 }, () => job()));
    expect(searchJobs(b, {}).returned).toBe(20);
    // The cap is the cost control: a tool that can be talked into returning the
    // whole board is a token bomb.
    expect(searchJobs(b, { limit: 500 }).returned).toBe(50);
    expect(searchJobs(b, { limit: 500 }).total).toBe(80);
  });

  it("reports the full total alongside the page", () => {
    const b = board(Array.from({ length: 30 }, () => job()));
    const page = searchJobs(b, { limit: 10, offset: 25 });
    expect(page.total).toBe(30);
    expect(page.returned).toBe(5);
    expect(page.offset).toBe(25);
  });

  it("returns newest first when there is no query", () => {
    const b = board([
      job({ slug: "older", postedAt: daysBefore(10) }),
      job({ slug: "newer", postedAt: daysBefore(1) }),
    ]);
    expect(searchJobs(b, {}).jobs.map((j) => j.slug)).toEqual(["newer", "older"]);
  });
});

describe("boardStats", () => {
  const b = board([
    job({ clusters: ["rag"], country: "US", salaryUsd: 200_000, seniority: "staff" }),
    job({ clusters: ["rag"], country: "US", salaryUsd: 100_000, seniority: "staff" }),
    job({ clusters: ["agents"], country: "GB", salaryUsd: null, seniority: "mid" }),
  ]);

  it("counts every match, not just the first page", () => {
    const big = board(Array.from({ length: 80 }, () => job({ clusters: ["rag"] })));
    // Aggregates must ignore the search page size or every stat over a large
    // board silently reports 50.
    expect(boardStats(big, "cluster").buckets[0].jobs).toBe(80);
  });

  it("medians only the priced roles", () => {
    const stats = boardStats(b, "country");
    const us = stats.buckets.find((x) => x.key === "US");
    expect(us?.jobs).toBe(2);
    expect(us?.medianSalaryUsd).toBe(150_000);

    const gb = stats.buckets.find((x) => x.key === "GB");
    expect(gb?.jobs).toBe(1);
    expect(gb?.pricedJobs).toBe(0);
    expect(gb?.medianSalaryUsd).toBeNull();
  });

  it("counts a job once per cluster it carries", () => {
    const multi = board([job({ clusters: ["rag", "agents"] })]);
    const stats = boardStats(multi, "cluster");
    expect(stats.totalJobs).toBe(1);
    expect(stats.buckets.map((x) => x.key).sort()).toEqual(["agents", "rag"]);
  });

  it("scopes to exactly the set search would return", () => {
    // A filtered stat and a filtered search have to describe the same roles, or
    // an agent gets a median for one population and examples from another.
    const filters = { seniority: "staff" };
    expect(boardStats(b, "country", filters).totalJobs).toBe(searchJobs(b, filters).total);
  });

  it("honours topN", () => {
    const many = board(
      Array.from({ length: 10 }, (_, i) => job({ company: `Co ${i}` })),
    );
    expect(boardStats(many, "company", {}, 3).buckets).toHaveLength(3);
  });
});

describe("getCompany", () => {
  const b = board([
    job({ company: "Shield AI", companySlug: "shieldai" }),
    job({ company: "Shield AI", companySlug: "shieldai" }),
    job({ company: "Acme", companySlug: "acme" }),
  ]);

  it("accepts a slug or a display name", () => {
    expect(getCompany(b, "shieldai")?.openRoles).toBe(2);
    expect(getCompany(b, "Shield AI")?.openRoles).toBe(2);
  });

  it("falls back to a substring so a partial name still lands", () => {
    expect(getCompany(b, "shield")?.company).toBe("Shield AI");
  });

  it("returns null rather than an empty result for an unknown company", () => {
    expect(getCompany(b, "nosuchco")).toBeNull();
  });
});

describe("trimDescription", () => {
  it("leaves short adverts alone", () => {
    expect(trimDescription("short", 100)).toBe("short");
  });

  it("truncates long ones and says so", () => {
    const trimmed = trimDescription("x".repeat(500), 100)!;
    expect(trimmed.length).toBeLessThan(200);
    expect(trimmed).toContain("truncated");
  });

  it("passes null through", () => {
    expect(trimDescription(null)).toBeNull();
  });
});

describe("listSkills", () => {
  it("returns the vocabulary the filters actually accept", () => {
    // Without this an agent guesses at names — "ml-ops" vs "mlops" — and gets
    // zero results for a query that should have matched.
    const v = listSkills(board([]));
    expect(v.clusters.map((c) => c.id)).toContain("rag");
    expect(v.seniorities).toContain("staff");
    expect(v.remoteTypes).toEqual(["remote", "hybrid", "onsite"]);
  });
});
