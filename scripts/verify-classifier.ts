/**
 * Preflight: prove the classifier is loadable and sane before an ingest starts.
 *
 * Exists because a run once polled all 744 feeds and rewrote everything it
 * touched using title regexes alone — the model directory resolved relative to
 * the working directory, `npm run -w` sets that to engine/, and the miss was
 * silent. This fails in seconds instead.
 *
 * Run: npx tsx scripts/verify-classifier.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENCODER_DIR,
  ENCODER_FILE,
  ENCODER_THRESHOLD,
  ENCODER_WINDOW,
} from "../engine/src/config.ts";
import { encoderAvailable, encoderScore } from "../engine/src/pipeline/encoder.ts";

/**
 * The weights are fetched from a release asset at run time, so a truncated or
 * swapped download is a real possibility that would look exactly like a bad
 * model. ml/model/manifest.json is committed; the files are not.
 */
function verifyChecksums(): boolean {
  const manifestPath = join(ENCODER_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`FAIL: no manifest at ${manifestPath}`);
    return false;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    { sha256: string; bytes: number }
  >;
  let ok = true;
  for (const [name, want] of Object.entries(manifest)) {
    const p = join(ENCODER_DIR, name);
    if (!existsSync(p)) {
      console.error(`  FAIL ${name}: missing`);
      ok = false;
      continue;
    }
    const buf = readFileSync(p);
    const got = createHash("sha256").update(buf).digest("hex");
    if (got !== want.sha256 || buf.length !== want.bytes) {
      console.error(
        `  FAIL ${name}: got ${buf.length} bytes / ${got.slice(0, 16)}…, ` +
          `expected ${want.bytes} / ${want.sha256.slice(0, 16)}…`,
      );
      ok = false;
    } else {
      console.log(`  ok   ${name} (${buf.length.toLocaleString()} bytes)`);
    }
  }
  return ok;
}

// Two adverts the model must not get wrong. Not a substitute for the held-out
// evaluation — just a tripwire for "loaded the wrong thing" or "loaded nothing".
const CASES: { name: string; title: string; body: string; expect: "in" | "out" }[] = [
  {
    name: "obvious in-scope",
    title: "Senior Machine Learning Engineer, LLM Inference",
    body:
      "You will build and optimise low-latency serving for large language models, " +
      "own our vLLM deployment, fine-tune open-weight models and run evals for the " +
      "RAG pipeline that powers our assistant.",
    expect: "in",
  },
  {
    name: "obvious out-of-scope",
    title: "Account Executive, Enterprise Sales",
    body:
      "Own a book of business, run the full sales cycle from prospecting to close, " +
      "hit quota, and partner with marketing on pipeline generation.",
    expect: "out",
  },
];

async function main(): Promise<void> {
  console.log(`encoder dir : ${ENCODER_DIR}`);
  console.log(`model file  : ${ENCODER_FILE}`);
  console.log(`window      : ${ENCODER_WINDOW}`);
  console.log(`threshold   : ${ENCODER_THRESHOLD}`);

  if (!encoderAvailable()) {
    console.error(`\nFAIL: no model files at ${ENCODER_DIR}`);
    process.exit(1);
  }

  console.log("\nchecksums:");
  if (!verifyChecksums()) {
    console.error("\nFAIL: model files do not match the committed manifest");
    process.exit(1);
  }

  console.log("\nsanity cases:");

  let bad = 0;
  for (const c of CASES) {
    const p = await encoderScore("j_preflight", c.title, "Acme", "London, UK", c.body);
    const got = p >= ENCODER_THRESHOLD ? "in" : "out";
    const ok = got === c.expect;
    // Margin matters as much as the side of the line: a model that has loaded
    // but is scoring everything near 0.5 is broken in a way a bare pass hides.
    const confident = c.expect === "in" ? p > 0.9 : p < 0.1;
    if (!ok || !confident) bad++;
    console.log(
      `  ${ok && confident ? "ok  " : "FAIL"} ${c.name}: p(in)=${p.toFixed(4)} ` +
        `-> ${got} (expected ${c.expect}${ok && !confident ? ", but not confidently" : ""})`,
    );
  }

  if (bad > 0) {
    console.error(`\nFAIL: ${bad}/${CASES.length} sanity cases wrong — refusing to ingest`);
    process.exit(1);
  }
  console.log("\nclassifier OK");
}

main().catch((e) => {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
});
