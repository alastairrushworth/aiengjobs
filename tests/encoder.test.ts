import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { serialiseAdvert, inScope } from "../engine/src/pipeline/encoder.ts";
import { ENCODER_DIR, ENCODER_THRESHOLD } from "../engine/src/config.ts";

// A relative ENCODER_DIR resolved against the working directory, and
// `npm run -w @aiengjobs/engine` sets that to engine/. The model was silently
// not found, encoderAvailable() returned false, and a whole ingest classified
// on title regexes alone without erroring. The path must be cwd-independent.
describe("ENCODER_DIR", () => {
  it("is absolute, so it cannot depend on the working directory", () => {
    expect(isAbsolute(ENCODER_DIR)).toBe(true);
  });

  it("does not point inside the engine workspace", () => {
    expect(ENCODER_DIR).not.toMatch(/[/\\]engine[/\\]ml[/\\]model$/);
  });
});

// The encoder was fine-tuned on adverts serialised in one exact shape. A stray
// space or reordered field scores every posting off-distribution — silently,
// with plausible-looking probabilities. These assertions are the byte-level
// contract with ml/gold/labels.jsonl and the .txt corpus it was trained from.
describe("serialiseAdvert", () => {
  it("reproduces the training corpus template exactly", () => {
    expect(
      serialiseAdvert("j_abc", "ML Engineer", "Acme", "London, UK", "We build things."),
    ).toBe(
      "ID: j_abc\n" +
        "TITLE: ML Engineer\n" +
        "COMPANY: Acme\n" +
        "LOCATION: London, UK\n" +
        "\n" +
        "FULL JOB ADVERT (verbatim, untruncated):\n" +
        "We build things.",
    );
  });

  it("keeps the blank line before the body marker", () => {
    // The corpus has exactly one empty line between LOCATION and the marker.
    const out = serialiseAdvert("i", "t", "c", "l", "b");
    expect(out).toContain("LOCATION: l\n\nFULL JOB ADVERT");
  });

  it("does not truncate or normalise the body", () => {
    const body = "  ragged\n\n\nwhitespace  and — unicode 👋  ";
    expect(serialiseAdvert("i", "t", "c", "l", body).endsWith(body)).toBe(true);
  });

  it("tolerates empty location, which feeds often omit", () => {
    expect(serialiseAdvert("i", "t", "c", "", "b")).toContain("LOCATION: \n\n");
  });
});

describe("inScope", () => {
  it("is inclusive at the threshold", () => {
    expect(inScope(ENCODER_THRESHOLD)).toBe(true);
    expect(inScope(ENCODER_THRESHOLD - 1e-9)).toBe(false);
  });

  it("brackets the operating point", () => {
    expect(inScope(1)).toBe(true);
    expect(inScope(0)).toBe(false);
  });
});
