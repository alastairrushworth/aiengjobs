import { describe, expect, it } from "vitest";
import { splitCsvRow } from "../engine/src/seed.ts";

describe("splitCsvRow", () => {
  it("splits a plain row", () => {
    expect(splitCsvRow("Anthropic,greenhouse,anthropic,anthropic.com,late")).toEqual([
      "Anthropic",
      "greenhouse",
      "anthropic",
      "anthropic.com",
      "late",
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    // A plain split turned this into six columns, failed the name/provider/slug
    // check, and counted the row as silently skipped.
    expect(splitCsvRow('"Scale AI, Inc",greenhouse,scaleai,scale.com,late')).toEqual([
      "Scale AI, Inc",
      "greenhouse",
      "scaleai",
      "scale.com",
      "late",
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(splitCsvRow('"He said ""hi""",lever,x,x.com,seed')[0]).toBe('He said "hi"');
  });

  it("trims surrounding whitespace", () => {
    expect(splitCsvRow(" Acme , lever , acme ")).toEqual(["Acme", "lever", "acme"]);
  });

  it("keeps empty trailing fields", () => {
    expect(splitCsvRow("Acme,lever,acme,,")).toEqual(["Acme", "lever", "acme", "", ""]);
  });
});
