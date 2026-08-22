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

/**
 * The defect this covers: `detectCurrency` used to return USD for any bare `$`,
 * so 42 Canadian and 4 Singaporean roles were published ~38% over their real
 * value. parseSalaryText had guarded the same case since it was written —
 * see "parseSalaryText currency detection" above — and these two functions are
 * not allowed to disagree about what a dollar sign means.
 */
describe("parseSalaryFromDescription currency detection", () => {
  const CA = "Salary Range: $145100.00 - $217700.00";

  it("reads a bare $ as the local dollar in a dollar-denominated country", () => {
    expect(parseSalaryFromDescription(CA, "CA")?.salaryCurrency).toBe("CAD");
    expect(parseSalaryFromDescription(CA, "AU")?.salaryCurrency).toBe("AUD");
    expect(parseSalaryFromDescription(CA, "SG")?.salaryCurrency).toBe("SGD");
    expect(parseSalaryFromDescription(CA, "NZ")?.salaryCurrency).toBe("NZD");
    expect(parseSalaryFromDescription(CA, "HK")?.salaryCurrency).toBe("HKD");
  });

  it("still reads the figures themselves correctly", () => {
    expect(parseSalaryFromDescription(CA, "CA")).toEqual({
      salaryMin: 145100,
      salaryMax: 217700,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
    });
  });

  it("keeps USD where the country writes something other than a dollar", () => {
    // A "$" in a British or German advert is a deliberate USD quote: those
    // markets write £ and €, so the symbol carries information.
    expect(parseSalaryFromDescription(CA, "GB")?.salaryCurrency).toBe("USD");
    expect(parseSalaryFromDescription(CA, "DE")?.salaryCurrency).toBe("USD");
    expect(parseSalaryFromDescription(CA, "US")?.salaryCurrency).toBe("USD");
  });

  it("keeps USD when the role has no country at all", () => {
    expect(parseSalaryFromDescription(CA)?.salaryCurrency).toBe("USD");
    expect(parseSalaryFromDescription(CA, null)?.salaryCurrency).toBe("USD");
  });

  it("lets an explicit currency in the text beat the country", () => {
    expect(
      parseSalaryFromDescription("Salary Range: $145100 - $217700 USD", "CA")?.salaryCurrency,
    ).toBe("USD");
    expect(
      parseSalaryFromDescription("Pay range: CA$120000 - CA$150000", "US")?.salaryCurrency,
    ).toBe("CAD");
    expect(
      parseSalaryFromDescription("Salary: £90000 - £120000", "CA")?.salaryCurrency,
    ).toBe("GBP");
    expect(
      parseSalaryFromDescription("Compensation: €80000 - €110000", "CA")?.salaryCurrency,
    ).toBe("EUR");
  });

  it("does not mistake the $ inside CA$ for a bare dollar", () => {
    // The ordering trap: /A\$/ and /\$/ both match inside "CA$", so the
    // most-specific spelling has to be tested first.
    expect(
      parseSalaryFromDescription("Pay range: CA$120000 - CA$150000")?.salaryCurrency,
    ).toBe("CAD");
    expect(
      parseSalaryFromDescription("Pay range: A$140000 - A$180000")?.salaryCurrency,
    ).toBe("AUD");
  });
});

/**
 * Adverts that quote the same role in two currencies. These are the cases that
 * make a naive priority ordering wrong: whichever currency wins, the figures
 * the range pattern grabbed belong to the other one about half the time.
 */
describe("parseSalaryFromDescription with more than one currency in the window", () => {
  const DUAL =
    "Salary range for this position is $180000 to $240000 USD ($175000 to $245000 CAD) per year.";

  it("takes the role's own currency when the advert names it", () => {
    expect(parseSalaryFromDescription(DUAL, "US")).toEqual({
      salaryMin: 180000,
      salaryMax: 240000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
    expect(parseSalaryFromDescription(DUAL, "CA")?.salaryCurrency).toBe("CAD");
  });

  it("resolves a euro-area role onto EUR rather than the leading dollars", () => {
    const triple =
      "Salary range for this position is $180000 to $240000 USD per year. (Per Year: $175000 to $245000 CAD | €116000 to €154000 EUR)";
    expect(parseSalaryFromDescription(triple, "DE")?.salaryCurrency).toBe("EUR");
  });

  it("gives up rather than guess when none of them is the local one", () => {
    // A wrong salary is worse than no salary: it reaches the card, the /stats
    // medians and the JobPosting baseSalary.
    expect(parseSalaryFromDescription(DUAL, "SE")).toBeNull();
    expect(parseSalaryFromDescription(DUAL)).toBeNull();
  });

  it("moves on to a later pay window instead of abandoning the advert", () => {
    const text =
      `Compensation is quoted in $100000 USD and €90000 EUR depending on entity. ` +
      `${"filler ".repeat(80)} The base salary for this role is $185000.`;
    expect(parseSalaryFromDescription(text, "US")?.salaryMin).toBe(185000);
  });
});

describe("parseSalaryFromDescription currency-marker overlaps", () => {
  it("does not read the A$ inside CA$ as Australian dollars", () => {
    // Docker posts "Canada: CA$243250 – CA$347500 / United States: $175350 …".
    // Reading CA$ as two currencies at once discarded the whole advert.
    const docker =
      "Compensation & Equity Canada: CA$243250 – CA$347500 + equity United States: $175350 – $250500 + equity";
    expect(parseSalaryFromDescription(docker, "CA")).toEqual({
      salaryMin: 243250,
      salaryMax: 347500,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
    });
  });

  it("does not read the S$ inside US$ as Singapore dollars", () => {
    expect(
      parseSalaryFromDescription("Salary: US$180000 - US$240000", "SG")?.salaryCurrency,
    ).toBe("USD");
  });

  it("no longer reads 'Europe' or 'neural' as a euro sign", () => {
    // /€|eur/i without a word boundary matched both, which labelled a San
    // Francisco role's dollars as euros.
    expect(
      parseSalaryFromDescription("Salary: $180000–$300000. We're based in Europe.", "US")
        ?.salaryCurrency,
    ).toBe("USD");
    expect(
      parseSalaryFromDescription("Salary: $150000–$200000 for neural network research.", "US")
        ?.salaryCurrency,
    ).toBe("USD");
  });
});
