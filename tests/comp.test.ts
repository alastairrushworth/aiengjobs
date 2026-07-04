import { describe, expect, it } from "vitest";
import { parseSalaryText } from "../engine/src/pipeline/comp.ts";

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
