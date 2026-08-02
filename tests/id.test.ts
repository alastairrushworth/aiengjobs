import { describe, expect, it } from "vitest";
import { jobSlug, slugify, shortHash } from "../engine/src/util/id.ts";

const LONG_NAGARRO_TITLE =
  "Associate Distinguished Engineer (Enterprise Architecture, Cloud Architecture, GenrativeAI, E-Commerce Domain)";

describe("jobSlug", () => {
  it("stays within the 110-character cap", () => {
    expect(jobSlug("nagarro", LONG_NAGARRO_TITLE, "ext-1").length).toBeLessThanOrEqual(110);
  });

  it("keeps the disambiguating hash even when the title fills the budget", () => {
    // The regression: the hash used to be truncated away, so two postings at
    // one company with a long shared title prefix produced identical slugs and
    // the second was dropped on `jobs.slug UNIQUE`.
    const a = jobSlug("nagarro", LONG_NAGARRO_TITLE, "ext-1");
    const b = jobSlug("nagarro", LONG_NAGARRO_TITLE, "ext-2");
    expect(a).toMatch(new RegExp(`-${shortHash("ext-1", 6)}$`));
    expect(b).toMatch(new RegExp(`-${shortHash("ext-2", 6)}$`));
    expect(a).not.toBe(b);
  });

  it("distinguishes postings whose titles differ only past the cap", () => {
    const prefix = "Senior Staff Machine Learning Engineer, Foundation Models and Applied Research Platform";
    const a = jobSlug("some-very-long-company-name", `${prefix} — Alpha`, "x1");
    const b = jobSlug("some-very-long-company-name", `${prefix} — Beta`, "x2");
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(110);
    expect(b.length).toBeLessThanOrEqual(110);
  });

  it("survives a company slug long enough to fill the budget alone", () => {
    const slug = jobSlug("x".repeat(300), "Engineer", "ext");
    expect(slug.length).toBeLessThanOrEqual(110);
    expect(slug.endsWith(shortHash("ext", 6))).toBe(true);
  });

  it("never leaves a doubled or trailing hyphen at a truncation boundary", () => {
    for (const n of [40, 60, 80, 100, 120, 140]) {
      const slug = jobSlug("acme", `${"word ".repeat(n)}end`, `id-${n}`);
      expect(slug).not.toMatch(/--/);
      expect(slug).not.toMatch(/-$/);
    }
  });

  it("still round-trips a short title unchanged", () => {
    expect(jobSlug("openai", "Software Engineer, API Agents", "abc")).toBe(
      `openai-${slugify("Software Engineer, API Agents")}-${shortHash("abc", 6)}`,
    );
  });
});
