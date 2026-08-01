import { describe, expect, it } from "vitest";
import {
  formatSalary,
  median,
  postedAgo,
  safeUrl,
  salaryMidpointUsd,
  roleType,
  type SalaryFields,
} from "../site/src/lib/format.ts";
import { jsonLdScript } from "../site/src/lib/jsonld.ts";

describe("safeUrl", () => {
  it("allows http(s) only", () => {
    expect(safeUrl("https://example.com/apply")).toBe("https://example.com/apply");
    expect(safeUrl("http://example.com")).toBe("http://example.com");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,hi")).toBeNull();
    expect(safeUrl("  https://x.io ")).toBe("https://x.io");
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl("")).toBeNull();
  });
});

describe("jsonLdScript", () => {
  it("escapes script-breakout characters", () => {
    const out = jsonLdScript({ title: 'Engineer</script><img src=x onerror=alert(1)>' });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<img");
    // Still valid JSON that round-trips to the original string.
    expect(JSON.parse(out).title).toBe(
      "Engineer</script><img src=x onerror=alert(1)>",
    );
  });
});

describe("formatSalary", () => {
  it("formats a USD yearly range", () => {
    expect(
      formatSalary({ salaryMin: 165_000, salaryMax: 330_000 }),
    ).toBe("$165k–330k/yr");
  });

  it("hides implausible parses", () => {
    expect(formatSalary({ salaryMin: 34_500_000 })).toBeNull();
    expect(formatSalary({ salaryMin: 500 })).toBeNull();
  });

  it("annualizes the plausibility check for hourly rates", () => {
    expect(formatSalary({ salaryMin: 45, salaryMax: 55, salaryPeriod: "hour" })).toBe(
      "$45–55/hour",
    );
  });

  it("hides pay in a currency we have no rate for", () => {
    // Assuming 1:1 would render this ~$1.7M role-of-the-year; it's really ~$78k.
    expect(
      formatSalary({
        salaryMin: 94_633,
        salaryMax: 141_941,
        salaryCurrency: "XYZ",
        salaryPeriod: "month",
      }),
    ).toBeNull();
  });

  it("converts a currency that does have a rate", () => {
    expect(
      formatSalary({
        salaryMin: 94_633,
        salaryMax: 141_941,
        salaryCurrency: "CZK",
        salaryPeriod: "month",
      }),
    ).toBe("CZK 95k–142k/month");
  });
});

describe("salary gate consistency", () => {
  // Regression: formatSalary used to gate on salaryMax while
  // salaryMidpointUsd gated on the midpoint, so a role could be listed (and
  // selected) on "Roles with published pay" while rendering no pay at all.
  const cases: SalaryFields[] = [
    { salaryMin: 131_975, salaryMax: 197_966, salaryCurrency: "CZK", salaryPeriod: "month" },
    { salaryMin: 100_000, salaryMax: 3_500_000 },
    { salaryMin: 165_000, salaryMax: 330_000 },
    { salaryMin: 45, salaryMax: 55, salaryPeriod: "hour" },
    { salaryMin: 40_750, salaryMax: 46_333, salaryCurrency: "PLN", salaryPeriod: "month" },
    { salaryCurrency: "USD" },
  ];

  it("agrees across display and midpoint", () => {
    for (const job of cases) {
      const priced = salaryMidpointUsd(job, {}) !== null;
      expect(formatSalary(job, {}) !== null).toBe(priced);
    }
  });
});

describe("salaryMidpointUsd", () => {
  it("uses live FX rates when provided", () => {
    const mid = salaryMidpointUsd(
      { salaryMin: 100_000, salaryMax: 120_000, salaryCurrency: "GBP" },
      { GBP: 1.3 },
    );
    expect(mid).toBe(110_000 * 1.3);
  });

  it("falls back to the static table for missing rates", () => {
    const mid = salaryMidpointUsd({ salaryMin: 100_000, salaryCurrency: "GBP" }, {});
    expect(mid).toBeCloseTo(127_000);
  });

  it("rejects outliers", () => {
    expect(salaryMidpointUsd({ salaryMin: 34_500_000 })).toBeNull();
  });
});

describe("median", () => {
  it("computes median for odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("postedAgo", () => {
  const gen = "2026-07-01T00:00:00Z";
  it("renders relative stamps", () => {
    expect(postedAgo("2026-07-01T00:00:00Z", gen)).toBe("today");
    expect(postedAgo("2026-06-28T00:00:00Z", gen)).toBe("3d ago");
    expect(postedAgo("2026-06-01T00:00:00Z", gen)).toBe("4w ago");
    expect(postedAgo("2026-01-01T00:00:00Z", gen)).toBe("6mo ago");
    expect(postedAgo("2024-01-01T00:00:00Z", gen)).toBe("2y ago");
    expect(postedAgo(undefined, gen)).toBeNull();
  });

  // Cards render this straight into a badge, so a future date (an ATS posting
  // dated ahead of the nightly export) has to read as "today", never "-2d ago".
  it("floors future postings at today", () => {
    expect(postedAgo("2026-07-05T00:00:00Z", gen)).toBe("today");
  });

  it("returns null rather than a stamp for unparseable dates", () => {
    expect(postedAgo("not-a-date", gen)).toBeNull();
  });
});

describe("roleType", () => {
  it("buckets titles into role families", () => {
    expect(roleType({ title: "Senior Data Scientist", normalizedTitle: "" })).toBe(
      "Data Scientist",
    );
    expect(roleType({ title: "LLM Engineer", normalizedTitle: "" })).toBe("AI Engineer");
    expect(roleType({ title: "Site Reliability Engineer", normalizedTitle: "" })).toBe(
      "Software Engineer",
    );
  });
});
