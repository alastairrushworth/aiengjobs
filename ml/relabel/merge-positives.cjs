// Merge the v4 positive audit back into labels.jsonl.
//
//   node ml/relabel/merge-positives.cjs [--write]
//
// The audit covered every row that was label=in under a pre-v4 rubric (1,035 of
// them). None of those ids are in gold.jsonl — the gold set was already relabelled
// under v4 by merge.cjs — so this touches labels.jsonl only and cannot reopen a
// gold/labels disagreement.
//
// Without --write it reports what would change and exits.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const WRITE = process.argv.includes("--write");

const readJsonl = (p) =>
  fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const writeJsonl = (p, rows) =>
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const labels = readJsonl(path.join(ML, "gold/labels.jsonl"));
const gold = readJsonl(path.join(ML, "gold/gold.jsonl"));

const v4 = new Map();
for (const f of fs.readdirSync(path.join(ML, "labels")).filter((f) => /^v4pos-\d+\.jsonl$/.test(f)).sort()) {
  for (const r of readJsonl(path.join(ML, "labels", f))) v4.set(r.id, r);
}
console.log(`v4 positive relabels: ${v4.size}`);

const goldIds = new Set(gold.map((g) => g.id));
const overlap = [...v4.keys()].filter((id) => goldIds.has(id));
if (overlap.length) {
  console.log(`\nWARNING: ${overlap.length} audited ids are also in gold.jsonl; gold is not updated here.`);
}

let flips = 0, held = 0, missing = 0;
const newLabels = labels.map((l) => {
  const r = v4.get(l.id);
  if (!r) return l;
  if (r.label !== l.label) flips++; else held++;
  return {
    ...l,
    label: r.label,
    confidence: r.confidence,
    ambiguous: r.ambiguous,
    reason: r.reason,
    evidence: r.evidence,
    rubric: "v4",
    ...(r.label !== l.label ? { prev_label: l.label } : {}),
  };
});

const seen = new Set(labels.map((l) => l.id));
for (const id of v4.keys()) if (!seen.has(id)) missing++;

const count = (rows, v) => rows.filter((r) => r.label === v).length;
console.log(`\nlabels.jsonl: ${labels.length} rows`);
console.log(`  in: ${count(labels, "in")} -> ${count(newLabels, "in")}   out: ${count(labels, "out")} -> ${count(newLabels, "out")}`);
console.log(`  audited: ${flips + held} (flipped in->out ${flips}, held in ${held})`);
if (missing) console.log(`  audited ids not found in labels.jsonl: ${missing}`);

const byRubric = {};
for (const r of newLabels) byRubric[r.rubric || "none"] = (byRubric[r.rubric || "none"] || 0) + 1;
console.log(`  rubric after merge: ${JSON.stringify(byRubric)}`);

const remainingPreV4In = newLabels.filter((r) => r.label === "in" && r.rubric !== "v4").length;
console.log(`  rows still label=in under a pre-v4 rubric: ${remainingPreV4In}`);

if (WRITE) {
  writeJsonl(path.join(ML, "gold/labels.jsonl"), newLabels);
  console.log(`\nwritten.`);
} else {
  console.log(`\n(dry run — pass --write to apply)`);
}
