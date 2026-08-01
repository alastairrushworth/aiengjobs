/**
 * Train/inference parity. A fine-tuned encoder is only valid on inputs shaped
 * the way its training inputs were shaped, so these are not style rules — a
 * violation silently degrades every classification instead of failing.
 *
 * The authoritative side is always the training run: ml/train_encoder.py and
 * the ml/ads/*.txt corpus it consumed. Inference must follow them, never the
 * other way round. See ml/TRAINING_INFERENCE_PARITY.md.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENCODER_WINDOW } from "../engine/src/config.ts";
import { serialiseAdvert } from "../engine/src/pipeline/encoder.ts";

const TRAIN_SCRIPT = "ml/train_encoder.py";
const ADS_DIR = "ml/ads";

describe("token window", () => {
  it("matches MAX_TOKENS in the training script", () => {
    const src = readFileSync(TRAIN_SCRIPT, "utf8");
    const m = src.match(/^MAX_TOKENS\s*=\s*(\d+)/m);
    // Fail closed: if the constant cannot be located the guard is not working,
    // which is worse than a mismatch because it looks like it passed.
    expect(m, `no MAX_TOKENS assignment found in ${TRAIN_SCRIPT}`).not.toBeNull();
    expect(
      ENCODER_WINDOW,
      `ENCODER_WINDOW (${ENCODER_WINDOW}) must equal MAX_TOKENS (${m?.[1]}) in ` +
        `${TRAIN_SCRIPT}. Retrain at the new length or revert — do not "just" ` +
        `change one side. See ml/TRAINING_INFERENCE_PARITY.md.`,
    ).toBe(Number(m![1]));
  });
});

describe("advert serialisation", () => {
  // The corpus is the contract: these are the exact byte sequences the weights
  // were fitted on. Round-tripping real files catches header drift that a
  // hand-written fixture would not, because the fixture would be edited to match.
  const files = readdirSync(ADS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .filter((_, i) => i % 97 === 0); // ~50 spread across the corpus

  it("has a corpus to check against", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("reproduces the training corpus byte for byte", () => {
    const header =
      /^ID: (.*)\nTITLE: (.*)\nCOMPANY: (.*)\nLOCATION: (.*)\n\nFULL JOB ADVERT \(verbatim, untruncated\):\n([\s\S]*)$/;
    const mismatched: string[] = [];
    for (const f of files) {
      const want = readFileSync(join(ADS_DIR, f), "utf8");
      const m = want.match(header);
      if (!m) {
        mismatched.push(`${f}: does not match the expected header layout`);
        continue;
      }
      const got = serialiseAdvert(m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
      if (got !== want) mismatched.push(`${f}: serialiseAdvert output differs`);
    }
    expect(
      mismatched,
      `serialiseAdvert no longer reproduces the training corpus. The model was ` +
        `fitted on these exact strings; changing the layout scores every advert ` +
        `off-distribution.\n${mismatched.slice(0, 5).join("\n")}`,
    ).toEqual([]);
  });
});
