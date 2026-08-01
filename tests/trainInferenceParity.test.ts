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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENCODER_WINDOW } from "../engine/src/config.ts";
import { serialiseAdvert } from "../engine/src/pipeline/encoder.ts";

const TRAIN_SCRIPT = "ml/train_encoder.py";
const ADS_DIR = "ml/ads";
const FIXTURE_DIR = "tests/fixtures";

const HEADER =
  /^ID: (.*)\nTITLE: (.*)\nCOMPANY: (.*)\nLOCATION: (.*)\n\nFULL JOB ADVERT \(verbatim, untruncated\):\n([\s\S]*)$/;

/**
 * Re-serialise each file from the fields its own header carries and demand the
 * bytes come back identical. The regex is an independent restatement of the
 * layout, so a change to serialiseAdvert alone always fails here.
 */
function roundTrip(dir: string, files: string[]): string[] {
  const mismatched: string[] = [];
  for (const f of files) {
    const want = readFileSync(join(dir, f), "utf8");
    const m = want.match(HEADER);
    if (!m) {
      mismatched.push(`${f}: does not match the expected header layout`);
      continue;
    }
    const got = serialiseAdvert(m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
    if (got !== want) mismatched.push(`${f}: serialiseAdvert output differs`);
  }
  return mismatched;
}

const DRIFT =
  `serialiseAdvert no longer reproduces the training corpus. The model was ` +
  `fitted on these exact strings; changing the layout scores every advert ` +
  `off-distribution.`;

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
  // ml/ads is 38MB of verbatim third-party adverts and is deliberately not in
  // the repo (see .gitignore), so CI has no corpus to round-trip. This file is
  // one real corpus entry with its body clipped — the same bytes the template
  // produced, header fields and all — so the layout guard still runs there.
  it("reproduces a committed corpus sample byte for byte", () => {
    const mismatched = roundTrip(FIXTURE_DIR, ["serialised-advert.txt"]);
    expect(mismatched, `${DRIFT}\n${mismatched.join("\n")}`).toEqual([]);
  });
});

// The corpus is the contract: these are the exact byte sequences the weights
// were fitted on. Round-tripping thousands of real files catches drift the
// single sample above cannot — odd characters, unusual field values — but it
// can only run where the corpus lives, which is a developer machine.
const corpus = existsSync(ADS_DIR);

describe.skipIf(!corpus)("advert serialisation (full corpus)", () => {
  // Guarded: vitest still evaluates the body of a skipped suite, so this must
  // not touch the filesystem when the corpus is absent.
  const files = (corpus ? readdirSync(ADS_DIR) : [])
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .filter((_, i) => i % 97 === 0); // ~50 spread across the corpus

  it("has a corpus to check against", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("reproduces the training corpus byte for byte", () => {
    const mismatched = roundTrip(ADS_DIR, files);
    expect(mismatched, `${DRIFT}\n${mismatched.slice(0, 5).join("\n")}`).toEqual([]);
  });
});
