import { describe, expect, it } from "vitest";
import { orderedPay } from "../engine/src/export/exportSnapshot.ts";

describe("orderedPay", () => {
  it("passes a well-ordered range through unchanged", () => {
    expect(orderedPay(120_000, 180_000)).toEqual({
      salaryMin: 120_000,
      salaryMax: 180_000,
    });
  });

  it("swaps a reversed range rather than dropping it", () => {
    // adobe-wd5-external-experienced-machine-learning-engineer-b5a53e carries
    // min 161700 / max 23415, which rendered as "$162k–$23k/yr" and emitted an
    // invalid MonetaryAmount in the JobPosting JSON-LD.
    expect(orderedPay(161_700, 23_415)).toEqual({
      salaryMin: 23_415,
      salaryMax: 161_700,
    });
  });

  it("collapses equal bounds to a single figure", () => {
    expect(orderedPay(150_000, 150_000)).toEqual({ salaryMin: 150_000 });
  });

  it("keeps a lone figure as a minimum", () => {
    expect(orderedPay(150_000, null)).toEqual({
      salaryMin: 150_000,
      salaryMax: undefined,
    });
  });

  it("emits nothing when there is no pay at all", () => {
    expect(orderedPay(null, null)).toEqual({
      salaryMin: undefined,
      salaryMax: undefined,
    });
  });
});
