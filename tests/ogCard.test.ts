import { describe, expect, it } from "vitest";
import {
  CONTENT_WIDTH,
  chipWidth,
  fitChips,
  fitTitle,
  shortLocation,
  splitPay,
  wrapLines,
} from "../site/src/lib/og/text.ts";

describe("fitTitle", () => {
  it("gives a short title the largest step", () => {
    expect(fitTitle("Data Scientist").fontSize).toBe(58);
  });

  it("steps down rather than overflowing", () => {
    const short = fitTitle("AI Engineer");
    const long = fitTitle(
      "Senior Lead Software Engineer, Full Stack (AI Platform & Knowledge Library) (Enterprise Platforms Technology)",
    );
    expect(long.fontSize).toBeLessThan(short.fontSize);
    expect(long.lines).toBeLessThanOrEqual(3);
  });

  it("keeps a real 102-character title whole", () => {
    // capitalone-wd12-…-senior-lead-software-engineer-full-stack. It fits in
    // three lines at the smallest step, so nothing should be cut.
    const title =
      "Senior Lead AI Engineer (Gen AI Platform Services: Distributed Systems)";
    expect(fitTitle(title).text).toBe(title);
  });

  it("truncates on a word boundary when even the smallest step will not fit", () => {
    const title = `Staff Machine Learning Engineer ${"Subsystem ".repeat(40)}`.trim();
    const fitted = fitTitle(title);
    expect(fitted.text.endsWith("…")).toBe(true);
    expect(fitted.lines).toBe(3);
    // What survives is whole words from the front, never half of one: the kept
    // text plus a space has to be a prefix of the original.
    const kept = fitted.text.slice(0, -1);
    expect(title.startsWith(`${kept} `)).toBe(true);
  });

  it("collapses the whitespace ATS payloads arrive with", () => {
    expect(fitTitle("  AI   Engineer\n(Agents) ").text).toBe("AI Engineer (Agents)");
  });

  it("never returns more than three lines", () => {
    for (const n of [1, 20, 80, 200, 500]) {
      expect(fitTitle("Engineering ".repeat(n)).lines).toBeLessThanOrEqual(3);
    }
  });
});

describe("wrapLines", () => {
  it("breaks at whole words", () => {
    expect(wrapLines("Machine Learning Engineer", 58, 300).every((l) => !l.startsWith(" "))).toBe(
      true,
    );
  });

  it("puts an unbreakable word on its own line rather than losing it", () => {
    const lines = wrapLines("AI Supercalifragilisticexpialidocious Engineer", 58, 200);
    expect(lines.join(" ")).toBe("AI Supercalifragilisticexpialidocious Engineer");
  });
});

describe("fitChips", () => {
  it("keeps chips in the order the skills arrived", () => {
    // Skills are ranked by how central they are to the role. Reordering to make
    // one more fit would misrepresent the job.
    expect(fitChips(["RAG", "LangChain", "Embeddings"], CONTENT_WIDTH)).toEqual([
      "RAG",
      "LangChain",
      "Embeddings",
    ]);
  });

  it("stops at four even with room to spare", () => {
    const many = ["A", "B", "C", "D", "E", "F"];
    expect(fitChips(many, 10_000)).toHaveLength(4);
  });

  it("drops chips that would not fit the space left by a salary", () => {
    const kept = fitChips(["Hugging Face", "Quantization", "RLHF", "PyTorch"], 200);
    const used = kept.reduce((n, s) => n + chipWidth(s), 0) + (kept.length - 1) * 10;
    expect(used).toBeLessThanOrEqual(200);
  });

  it("returns nothing when there is no room at all", () => {
    expect(fitChips(["Kubernetes"], 10)).toEqual([]);
  });

  it("copes with a role that has no skills", () => {
    expect(fitChips([], CONTENT_WIDTH)).toEqual([]);
  });
});

describe("shortLocation", () => {
  it("prefers city and region", () => {
    expect(shortLocation({ city: "Denver", region: "CO", country: "US" })).toBe("Denver, CO");
  });

  it("resolves a bare country code to a name", () => {
    // "IE" renders as an abbreviation nobody outside the pipeline knows.
    expect(shortLocation({ country: "IE" })).toBe("Ireland");
  });

  it("falls back to the first segment of a delimited ATS location", () => {
    // A real AT&T posting: "USA:TX:Plano / W Plano Pkwy - Adm & Dat:2900 W Plano Pkwy"
    expect(
      shortLocation({
        locationRaw: "USA:TX:Plano / W Plano Pkwy - Adm & Dat:2900 W Plano Pkwy",
      }),
    ).toBe("USA");
  });

  it("truncates a long raw location rather than running off the card", () => {
    const long = shortLocation({ locationRaw: "A".repeat(80) });
    expect(long!.length).toBeLessThanOrEqual(44);
    expect(long!.endsWith("…")).toBe(true);
  });

  it("returns null when the role has no location at all", () => {
    expect(shortLocation({})).toBeNull();
  });
});

describe("splitPay", () => {
  it("separates the figure from its period", () => {
    expect(splitPay("$180k–360k/yr")).toEqual({ amount: "$180k–360k", period: "/yr" });
  });

  it("handles sub-annual periods", () => {
    expect(splitPay("£450/day")).toEqual({ amount: "£450", period: "/day" });
  });

  it("leaves a figure with no period alone", () => {
    expect(splitPay("$180k")).toEqual({ amount: "$180k", period: null });
  });
});
