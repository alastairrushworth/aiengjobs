// Acceptance test for the classifier: 44 hand-curated canonical adverts, one or
// two per role archetype, none of which appear in ml/gold/labels.jsonl (the
// training set) or ml/gold/gold.jsonl (the held-out evaluation set). Run it
// after retraining to check the new model still gets the easy, archetypal calls
// right — it is a smoke test over the rubric's structure, not a statistical
// evaluation (ml/gold/gold.jsonl is that).
//
//   npx tsx ml/acceptance/run.ts
//
// Scores go through scoreText(), the exact shipped inference path (same
// tokenizer, window, ONNX graph). Ad files are pre-serialised with the training
// header, so what is scored here is byte-identical to what ingest would score.
// Exits 1 if any case lands on the wrong side of ENCODER_THRESHOLD.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scoreText, inScope } from "../../engine/src/pipeline/encoder.ts";
import { ENCODER_THRESHOLD } from "../../engine/src/config.ts";

const DIR = import.meta.dirname;
type Case = { id: string; archetype: string; expected: "in" | "out"; title: string; company: string };

const manifest: Case[] = readFileSync(join(DIR, "manifest.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const adFiles = new Set(readdirSync(join(DIR, "ads")));
const missing = manifest.filter((c) => !adFiles.has(`${c.id}.txt`));
if (missing.length) {
  console.error(`missing ad files for: ${missing.map((c) => c.id).join(", ")}`);
  process.exit(2);
}

async function main() {
  let failures = 0;
  console.log(`Acceptance set: ${manifest.length} cases, threshold ${ENCODER_THRESHOLD}\n`);
  for (const c of manifest) {
    const text = readFileSync(join(DIR, "ads", `${c.id}.txt`), "utf8");
    const p = await scoreText(text);
    const got = inScope(p) ? "in" : "out";
    const ok = got === c.expected;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${c.expected.padEnd(3)} got ${got.padEnd(3)} p=${p.toFixed(3)}  ` +
        `[${c.archetype}] ${c.title} @ ${c.company}`,
    );
  }
  console.log(`\n${manifest.length - failures}/${manifest.length} passed`);
  process.exit(failures ? 1 : 0);
}

main();
