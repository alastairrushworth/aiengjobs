import { describe, expect, it } from "vitest";
import { parseSalaryFromDescription, parseSalaryText } from "../engine/src/pipeline/comp.ts";

describe("parseSalaryText", () => {
  it("parses a yearly USD range", () => {
    expect(parseSalaryText("$165K - $330K")).toEqual({
      salaryMin: 165_000,
      salaryMax: 330_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
  });

  it("parses a GBP range with thousands separators", () => {
    expect(parseSalaryText("£90,000–£120,000")).toEqual({
      salaryMin: 90_000,
      salaryMax: 120_000,
      salaryCurrency: "GBP",
      salaryPeriod: "year",
    });
  });

  it("parses hourly rates below 1000", () => {
    expect(parseSalaryText("$45 - $55 per hour")).toEqual({
      salaryMin: 45,
      salaryMax: 55,
      salaryCurrency: "USD",
      salaryPeriod: "hour",
    });
  });

  it("parses monthly EUR", () => {
    expect(parseSalaryText("€7000 per month")).toEqual({
      salaryMin: 7_000,
      salaryMax: undefined,
      salaryCurrency: "EUR",
      salaryPeriod: "month",
    });
  });

  it("ignores 401(k) plan references", () => {
    expect(parseSalaryText("Competitive salary plus 401k match")).toBeNull();
    expect(parseSalaryText("Benefits include 401(k) and healthcare")).toBeNull();
  });

  it("still parses a real salary next to a 401k mention", () => {
    expect(parseSalaryText("$150,000 - $200,000 plus 401k")).toEqual({
      salaryMin: 150_000,
      salaryMax: 200_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
  });

  it("collapses equal min/max to a single bound", () => {
    expect(parseSalaryText("$200k")).toEqual({
      salaryMin: 200_000,
      salaryMax: undefined,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
  });

  it("returns null for text without plausible figures", () => {
    expect(parseSalaryText("Competitive compensation")).toBeNull();
    expect(parseSalaryText(undefined)).toBeNull();
    expect(parseSalaryText("")).toBeNull();
  });
});

describe("parseSalaryFromDescription", () => {
  it("finds a range stated several lines below its heading", () => {
    // Shape taken from a real Workday posting: the figures are nowhere near
    // the keyword, so a line-by-line scan misses them entirely.
    const text = [
      "About the role",
      "",
      "The applicable full salary ranges for this position, by specific state, are listed below:",
      "",
      "New York City Metro Area:",
      "",
      "$199,700.00 - $292,800.00",
    ].join("\n");
    expect(parseSalaryFromDescription(text)).toEqual({
      salaryMin: 199_700,
      salaryMax: 292_800,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
  });

  it("skips a 'competitive salary' mention and keeps looking", () => {
    const text = "We offer a competitive salary and equity.\n\nBase pay range: $150,000 - $200,000";
    expect(parseSalaryFromDescription(text)).toEqual({
      salaryMin: 150_000,
      salaryMax: 200_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
  });

  it("accepts a lone figure only when the window is unambiguous", () => {
    expect(parseSalaryFromDescription("The base salary for this role is $180,000.")).toEqual({
      salaryMin: 180_000,
      salaryMax: undefined,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
    // Two unrelated amounts, no stated band — we can't tell which is the wage.
    expect(
      parseSalaryFromDescription("Salary is competitive. $5,000 signing bonus and $1,000 stipend."),
    ).toBeNull();
  });

  it("rejects a template band spanning every level", () => {
    // Real Anduril posting — genuinely published, but a 15x span is not a wage.
    expect(parseSalaryFromDescription("Salary Range\n\n$23,000 — $336,000 USD")).toBeNull();
  });

  it("ignores figures with no currency marker", () => {
    expect(
      parseSalaryFromDescription("Our compensation team supports 250,000 employees since 2011."),
    ).toBeNull();
  });

  it("does not read 'day one' as a daily rate", () => {
    expect(
      parseSalaryFromDescription("Salary: $120,000 - $150,000. Benefits start on day one."),
    ).toEqual({
      salaryMin: 120_000,
      salaryMax: 150_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
  });

  it("reads an explicitly rated hourly band", () => {
    expect(parseSalaryFromDescription("Pay range: $45 - $55 per hour.")).toEqual({
      salaryMin: 45,
      salaryMax: 55,
      salaryCurrency: "USD",
      salaryPeriod: "hour",
    });
  });

  it("returns null for descriptions that never mention pay", () => {
    expect(parseSalaryFromDescription("Build agents. Ship fast.")).toBeNull();
    expect(parseSalaryFromDescription(undefined)).toBeNull();
    expect(parseSalaryFromDescription("")).toBeNull();
  });
});

describe("parseSalaryText currency detection", () => {
  it("drops pay it cannot attribute to a currency", () => {
    // The Graphcore case: a bare "260400 - 352200" was PLN, and defaulting to
    // USD showed ~$70k as $260k.
    expect(parseSalaryText("260400 - 352200")).toBeNull();
    expect(parseSalaryText("120000 to 150000 per year")).toBeNull();
  });

  it("does not read dollar-suffixed currencies as USD", () => {
    expect(parseSalaryText("CA$120,000 - CA$150,000")?.salaryCurrency).toBe("CAD");
    expect(parseSalaryText("A$140,000 - A$180,000")?.salaryCurrency).toBe("AUD");
    expect(parseSalaryText("S$90,000 - S$120,000")?.salaryCurrency).toBe("SGD");
    expect(parseSalaryText("R$200,000 - R$300,000")?.salaryCurrency).toBe("BRL");
  });

  it("recognises non-symbol currency codes", () => {
    expect(parseSalaryText("CHF 150,000")?.salaryCurrency).toBe("CHF");
    expect(parseSalaryText("260400 - 352200 PLN")?.salaryCurrency).toBe("PLN");
    expect(parseSalaryText("₹4,000,000")?.salaryCurrency).toBe("INR");
  });

  it("still reads plain dollars, pounds and euros", () => {
    expect(parseSalaryText("$165K - $330K")?.salaryCurrency).toBe("USD");
    expect(parseSalaryText("£90,000–£120,000")?.salaryCurrency).toBe("GBP");
    expect(parseSalaryText("€80k per year")?.salaryCurrency).toBe("EUR");
  });
});
