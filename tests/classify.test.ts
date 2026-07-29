import { describe, expect, it } from "vitest";
import { classifyHeuristic } from "../engine/src/pipeline/classify.ts";
import {
  IN_TITLE_PATTERNS,
  OFF_TOPIC_TITLE_PATTERNS,
} from "../engine/src/config.ts";

const cls = (title: string) => classifyHeuristic(title)?.classification ?? null;

describe("classifyHeuristic", () => {
  it("rules out the hard-exclude signals", () => {
    expect(cls("Enterprise Sales Manager")).toBe("out");
    expect(cls("Product Designer")).toBe("out");
    expect(cls("General Application")).toBe("out");
  });

  it("rules in clear AI-engineering titles", () => {
    expect(cls("AI Engineer")).toBe("in");
    expect(cls("Member of Technical Staff")).toBe("in");
    expect(cls("Research Engineer, Post-Training")).toBe("in");
  });

  it("leaves genuinely ambiguous titles for the LLM", () => {
    // 39% of the board comes out of this bucket — it must stay null.
    expect(cls("Senior Software Engineer")).toBeNull();
    expect(cls("Staff Engineer, Platform")).toBeNull();
    expect(cls("Data Engineer")).toBeNull();
  });

  it("rules out off-topic job families without an LLM call", () => {
    expect(cls("Technical Recruiter")).toBe("out");
    expect(cls("Senior Accountant")).toBe("out");
    expect(cls("General Counsel")).toBe("out");
    expect(cls("Registered Nurse (Nights)")).toBe("out");
    expect(cls("Executive Assistant to the Founders")).toBe("out");
    expect(cls("Warehouse Operative")).toBe("out");
    expect(cls("Mechanical Engineer - San Leandro")).toBe("out");
    expect(cls("Business Development Representative")).toBe("out");
    expect(cls("Technical Account Manager")).toBe("out");
    expect(cls("Agente di commercio - settore pagamenti")).toBe("out");
  });

  // The ordering guard. OFF_TOPIC_TITLE_PATTERNS must be checked AFTER
  // IN_TITLE_PATTERNS, otherwise each of these real postings is silently dropped.
  it("keeps AI roles that also match an off-topic family", () => {
    expect(cls("Technical Program Manager, Cloud Inference")).toBe("in");
    expect(cls("Technical Program Manager, Safeguards (Infrastructure & Evals)")).toBe("in");
    expect(cls("Technical Program Manager, Gen AI Operations Planning")).toBe("in");
    expect(cls("Customer Support Engineer (Inference)")).toBe("in");
    expect(cls("Support Agent - X Payments")).toBe("in");
  });

  it("does not regress roles the off-topic list was tuned to spare", () => {
    // Dropped from the off-topic list on purpose — see config.ts.
    expect(cls("Solutions Architect - Infrastructure")).toBeNull();
    expect(cls("Software Quality Engineer (US)")).toBeNull();
    expect(cls("Clinician Scientist")).toBeNull();
  });
});

describe("OFF_TOPIC_TITLE_PATTERNS", () => {
  it("never fires on a title that carries an AI signal", () => {
    // A pattern that can only be reached when no IN pattern matches is safe by
    // construction; this asserts the two lists cannot both be the deciding rule.
    const aiTitles = [
      "AI Engineer, Inference",
      "LLM Research Scientist",
      "Forward Deployed Engineer",
      "Agentic Systems Engineer",
      "Member of Technical Staff, Post-Training",
    ];
    for (const t of aiTitles) {
      expect(IN_TITLE_PATTERNS.some((re) => re.test(t))).toBe(true);
      expect(cls(t)).toBe("in");
    }
  });

  it("has no pattern that matches a bare seniority/software title", () => {
    const mustStayAmbiguous = [
      "Senior Software Engineer",
      "Staff Software Engineer",
      "Backend Engineer",
      "Site Reliability Engineer",
      "Machine Learning Engineer",
      "Data Scientist",
      "Engineering Manager",
      "Security Engineer",
    ];
    for (const t of mustStayAmbiguous) {
      expect(
        OFF_TOPIC_TITLE_PATTERNS.some((re) => re.test(t)),
        `"${t}" must not be ruled out by an off-topic pattern`,
      ).toBe(false);
    }
  });
});
