import { describe, expect, it } from "vitest";
import type { JobDetail, McpJob } from "../mcp/src/board.ts";
import {
  compactJob,
  formatSalary,
  postedAgo,
  renderCompany,
  renderJob,
  renderJobRow,
  renderSearch,
  renderStats,
} from "../mcp/src/render.ts";
import { boardStats, getCompany, searchJobs } from "../mcp/src/tools.ts";
import type { Board } from "../mcp/src/board.ts";

/**
 * These exist because of a real regression in behaviour rather than in code:
 * Claude was using search results correctly and then presenting them without
 * apply links, because in a JSON blob of fifteen keys `applyUrl` reads as
 * plumbing. The rendering makes the title *be* the link so the URL can't be
 * dropped without dropping the role. Most of what follows guards that property.
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

const board = (jobs: McpJob[]): Board => ({
  generatedAt: GENERATED_AT,
  jobCount: jobs.length,
  clusters: [{ id: "rag", label: "Retrieval / RAG", skills: ["RAG"] }],
  fxRates: { USD: 1 },
  jobs,
});

describe("the apply link survives rendering", () => {
  it("makes the title the link, so the URL can't be dropped separately", () => {
    const row = renderJobRow(
      job({ title: "Senior RAG Engineer", applyUrl: "https://jobs.lever.co/x/y/apply" }),
      GENERATED_AT,
    );
    expect(row).toContain("[Senior RAG Engineer](<https://jobs.lever.co/x/y/apply>)");
  });

  it("gives every search result a link", () => {
    const b = board([job(), job(), job()]);
    const md = renderSearch(searchJobs(b, {}));
    expect(md.match(/\]\(</g)).toHaveLength(3);
  });

  it("gives every company result a link", () => {
    const b = board([job({ company: "Shield AI" }), job({ company: "Shield AI" })]);
    const md = renderCompany(getCompany(b, "Shield AI")!);
    expect(md.match(/\]\(</g)).toHaveLength(2);
  });

  it("puts an explicit apply link on the detail view", () => {
    const detail: JobDetail = {
      ...job({ applyUrl: "https://boards.greenhouse.io/x/jobs/1" }),
      generatedAt: GENERATED_AT,
      description: "Some advert text.",
      companyDomain: "acme.com",
      companyDescription: null,
      jobUrl: "https://frontierroles.com/jobs/job-1",
    };
    expect(renderJob(detail)).toContain("(<https://boards.greenhouse.io/x/jobs/1>)");
  });
});

describe("markdown safety", () => {
  it("wraps destinations so a URL containing parens doesn't end the link early", () => {
    // ATS query strings carry parens and commas routinely; a bare `)` would
    // terminate the markdown link mid-URL and produce a broken destination.
    const url = "https://example.com/apply?ref=(a,b)&x=1";
    expect(renderJobRow(job({ applyUrl: url }), GENERATED_AT)).toContain(`(<${url}>)`);
  });

  it("escapes brackets in a title", () => {
    const row = renderJobRow(job({ title: "Engineer [Remote]" }), GENERATED_AT);
    expect(row).toContain("[Engineer \\[Remote\\]](<");
  });
});

describe("the row carries what a follow-up needs", () => {
  it("includes the slug so get_job doesn't require another search", () => {
    const row = renderJobRow(job({ slug: "acme-ai-engineer-abc123" }), GENERATED_AT);
    expect(row).toContain("`acme-ai-engineer-abc123`");
  });

  it("shows company, location, level and age", () => {
    const row = renderJobRow(
      job({ company: "Shield AI", location: "Washington, DC", seniority: "staff" }),
      GENERATED_AT,
    );
    expect(row).toContain("Shield AI");
    expect(row).toContain("Washington, DC");
    expect(row).toContain("Staff");
    expect(row).toContain("1d ago");
  });
});

describe("formatSalary", () => {
  it("shows the currency it was posted in, not a conversion", () => {
    // Showing "$216k" for a role advertised in pounds is a conversion, not what
    // the employer said. The USD figure stays in the structured payload.
    const gbp = job({ salaryMin: 90_000, salaryMax: 120_000, salaryCurrency: "GBP", salaryUsd: 133_000 });
    expect(formatSalary(gbp)).toBe("£90k–£120k");
  });

  it("collapses an equal range to one figure", () => {
    expect(
      formatSalary(job({ salaryMin: 200_000, salaryMax: 200_000, salaryCurrency: "USD", salaryUsd: 200_000 })),
    ).toBe("$200k");
  });

  it("keeps hourly and daily rates readable instead of rounding them to thousands", () => {
    // Rounding everything to thousands turned a $90–120/hr contract into
    // "$0k–$0k/hr". The period suffix is what stops the figure reading as an
    // annual salary.
    const hourly = job({ salaryMin: 90, salaryMax: 120, salaryCurrency: "USD", salaryPeriod: "hour", salaryUsd: 218_400 });
    expect(formatSalary(hourly)).toBe("$90–$120/hr");

    const daily = job({ salaryMin: 650, salaryCurrency: "GBP", salaryPeriod: "day", salaryUsd: 216_000 });
    expect(formatSalary(daily)).toBe("£650/day");
  });

  it("falls back to the currency code when there's no symbol", () => {
    expect(
      formatSalary(job({ salaryMin: 500_000, salaryCurrency: "CZK", salaryUsd: 21_000 })),
    ).toBe("CZK 500k");
  });

  it("returns null when unpriced", () => {
    expect(formatSalary(job())).toBeNull();
  });

  it("defers to the site's plausibility gate rather than re-deriving one", () => {
    // salaryUsd is null exactly when site/src/lib/format.ts judged the stored
    // figures unpostable, and the website prints "Not published" for them.
    // Gating only on "both fields null?" let the raw numbers through, so
    // search_jobs rendered nuro-technical-lead-evaluation-infrastructure as
    // "$193.9m–$291.2m" for a role the site reports as unpriced.
    const implausible = job({
      salaryMin: 193_930_200,
      salaryMax: 291_150_200,
      salaryCurrency: "USD",
      salaryUsd: null,
    });
    expect(formatSalary(implausible)).toBeNull();

    const subannual = job({
      salaryMin: 170_000,
      salaryCurrency: "USD",
      salaryPeriod: "month",
      salaryUsd: null,
    });
    expect(formatSalary(subannual)).toBeNull();
  });
});

describe("postedAgo", () => {
  it("measures against the snapshot, not wall-clock now", () => {
    expect(postedAgo(daysBefore(3), GENERATED_AT)).toBe("3d ago");
    expect(postedAgo(daysBefore(0), GENERATED_AT)).toBe("today");
  });

  it("coarsens as things age", () => {
    expect(postedAgo(daysBefore(21), GENERATED_AT)).toBe("3w ago");
    expect(postedAgo(daysBefore(70), GENERATED_AT)).toBe("2mo ago");
  });

  it("handles a missing or unparseable date", () => {
    expect(postedAgo(null, GENERATED_AT)).toBeNull();
    expect(postedAgo("not a date", GENERATED_AT)).toBeNull();
  });
});

describe("renderSearch", () => {
  it("leads with the true total, not the page size", () => {
    const b = board(Array.from({ length: 40 }, () => job()));
    const md = renderSearch(searchJobs(b, { limit: 5 }));
    expect(md).toContain("**40 open roles match.**");
    expect(md).toContain("Showing 1–5.");
  });

  it("says so plainly when nothing matches, and points at the vocabulary", () => {
    const md = renderSearch(searchJobs(board([job()]), { query: "zzzz" }));
    expect(md).toContain("No open roles match");
    expect(md).toContain("list_skills");
  });

  it("dates itself", () => {
    expect(renderSearch(searchJobs(board([job()]), {}))).toContain("2026-07-31");
  });
});

describe("renderStats", () => {
  it("renders a table with the median and the priced count", () => {
    const b = board([
      job({ country: "US", salaryUsd: 200_000 }),
      job({ country: "US", salaryUsd: 100_000 }),
      job({ country: "GB", salaryUsd: null }),
    ]);
    const md = renderStats(boardStats(b, "country"));
    expect(md).toContain("| US | 2 | $150k | 2 |");
    // An unpriced bucket must read as "no data", never as zero pay.
    expect(md).toContain("| GB | 1 | — | 0 |");
  });

  it("states that unpriced roles are excluded rather than counted as zero", () => {
    const md = renderStats(boardStats(board([job()]), "country"));
    expect(md).toContain("not counted as zero");
  });
});

describe("compactJob", () => {
  it("keeps what a follow-up call needs and drops the redundant salary fields", () => {
    const c = compactJob(job({ salaryMin: 1, salaryMax: 2, salaryCurrency: "USD", salaryUsd: 3 }));
    expect(c).toHaveProperty("slug");
    expect(c).toHaveProperty("applyUrl");
    expect(c).toHaveProperty("salaryUsd", 3);
    expect(c).not.toHaveProperty("salaryMin");
    expect(c).not.toHaveProperty("salaryPeriod");
    expect(c).not.toHaveProperty("companySlug");
  });
});
