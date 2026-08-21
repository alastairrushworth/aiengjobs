// Merge the v4 relabel back into gold.jsonl and reconcile labels.jsonl.
//
//   node ml/relabel/merge.cjs [--write]
//
// Without --write it reports what would change and exits. gold.jsonl and
// labels.jsonl overlap on 498 rows (the same adverts), and before this pass they
// disagreed on 34 of them — so the reconciliation is the point, not a side effect.
//
// Fields preserved on gold rows: stratum, band, prev_cls, prev_conf, excerpt.
// evaluate.ts stratifies on title + prev_conf, so those must survive untouched.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const WRITE = process.argv.includes("--write");

const readJsonl = (p) =>
  fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const writeJsonl = (p, rows) =>
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const gold = readJsonl(path.join(ML, "gold/gold.jsonl"));
const labels = readJsonl(path.join(ML, "gold/labels.jsonl"));

const v4 = new Map();
for (const f of fs.readdirSync(path.join(ML, "labels")).filter((f) => /^v4gold-\d+\.jsonl$/.test(f)).sort()) {
  for (const r of readJsonl(path.join(ML, "labels", f))) v4.set(r.id, r);
}
console.log(`v4 relabels: ${v4.size}`);

// --- gold.jsonl ---------------------------------------------------------
let goldFlips = 0, goldCarried = 0;
const newGold = gold.map((g) => {
  const r = v4.get(g.id);
  if (!r) {
    goldCarried++;
    return { ...g, rubric: "v4-carried" }; // no ad text available to re-read
  }
  if (r.label !== g.label) goldFlips++;
  return {
    ...g,
    label: r.label,
    confidence: r.confidence,
    ambiguous: r.ambiguous,
    reason: r.reason,
    evidence: r.evidence,
    rubric: "v4",
    ...(r.label !== g.label ? { prev_label: g.label } : {}),
  };
});

// --- labels.jsonl -------------------------------------------------------
let labelFlips = 0, labelAgreed = 0, notInGold = 0;
const newLabels = labels.map((l) => {
  const r = v4.get(l.id);
  if (!r) { notInGold++; return l; }
  if (r.label !== l.label) labelFlips++; else labelAgreed++;
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

const count = (rows, v) => rows.filter((r) => r.label === v).length;
console.log(`\ngold.jsonl:   ${gold.length} rows`);
console.log(`  in: ${count(gold, "in")} -> ${count(newGold, "in")}   out: ${count(gold, "out")} -> ${count(newGold, "out")}`);
console.log(`  flipped: ${goldFlips}   carried unreviewed (no ad text): ${goldCarried}`);
console.log(`\nlabels.jsonl: ${labels.length} rows`);
console.log(`  in: ${count(labels, "in")} -> ${count(newLabels, "in")}   out: ${count(labels, "out")} -> ${count(newLabels, "out")}`);
console.log(`  rows touched: ${labelFlips + labelAgreed} (flipped ${labelFlips}, unchanged ${labelAgreed}); untouched: ${notInGold}`);

// Post-merge the two files must agree on every shared id.
const nl = new Map(newLabels.map((r) => [r.id, r]));
const stillDisagree = newGold.filter((g) => nl.has(g.id) && nl.get(g.id).label !== g.label);
console.log(`\ngold/labels disagreements after merge: ${stillDisagree.length}`);
for (const g of stillDisagree) console.log(`  ${g.company} — ${g.title}`);

console.log(`\nflips by direction:`);
const flips = newGold.filter((g) => g.prev_label);
console.log(`  in -> out: ${flips.filter((g) => g.label === "out").length}`);
console.log(`  out -> in: ${flips.filter((g) => g.label === "in").length}`);
for (const g of flips) console.log(`  ${g.prev_label} -> ${g.label}  ${g.company} — ${g.title}`);

if (WRITE) {
  writeJsonl(path.join(ML, "gold/gold.jsonl"), newGold);
  writeJsonl(path.join(ML, "gold/labels.jsonl"), newLabels);
  console.log(`\nwritten.`);
} else {
  console.log(`\n(dry run — pass --write to apply)`);
}
