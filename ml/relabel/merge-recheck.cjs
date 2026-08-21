// Merge the v4.1 re-audit back into labels.jsonl.
//
//   node ml/relabel/merge-recheck.cjs [--write]
//
// The re-audit re-read the 81 rows that v4.1's rule changes could reach, and
// re-labelled the ones that moved. Rows it confirmed are marked rubric v4.1
// without changing their label, so the corpus records what was checked rather
// than only what changed.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const WRITE = process.argv.includes("--write");
const SCRATCH = process.env.RECHECK_DIR || "";

const readJsonl = (p) =>
  fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const writeJsonl = (p, rows) =>
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const labels = readJsonl(path.join(ML, "gold/labels.jsonl"));

// Rows the re-audit re-labelled.
const changed = new Map();
for (const f of fs.readdirSync(path.join(ML, "labels")).filter((f) => /^v41-recheck-\d+\.jsonl$/.test(f)).sort()) {
  for (const r of readJsonl(path.join(ML, "labels", f))) changed.set(r.id, r);
}
// Rows the re-audit read or mechanically confirmed, and left alone.
const confirmed = new Set();
if (SCRATCH) {
  for (const f of ["recheck-movable.txt", "recheck-trivial.txt"]) {
    const p = path.join(SCRATCH, f);
    if (fs.existsSync(p)) for (const id of fs.readFileSync(p, "utf8").trim().split("\n")) confirmed.add(id.trim());
  }
}
console.log(`re-labelled: ${changed.size}   reviewed and confirmed: ${confirmed.size - changed.size}`);

let flipsIn = 0, flipsOut = 0, conf = 0, touched = 0;
const newLabels = labels.map((l) => {
  const r = changed.get(l.id);
  if (r) {
    touched++;
    if (r.label !== l.label) (r.label === "in" ? flipsIn++ : flipsOut++);
    return {
      ...l,
      label: r.label, confidence: r.confidence, ambiguous: r.ambiguous,
      reason: r.reason, evidence: r.evidence, rubric: "v4.1",
      ...(r.label !== l.label ? { prev_label: l.label } : {}),
    };
  }
  if (confirmed.has(l.id)) { conf++; return { ...l, rubric: "v4.1" }; }
  return l;
});

const count = (rows, v) => rows.filter((r) => r.label === v).length;
console.log(`\nlabels.jsonl: ${labels.length} rows`);
console.log(`  in: ${count(labels, "in")} -> ${count(newLabels, "in")}   out: ${count(labels, "out")} -> ${count(newLabels, "out")}`);
console.log(`  re-labelled ${touched} (out->in ${flipsIn}, in->out ${flipsOut}), confirmed-only ${conf}`);

const byRubric = {};
for (const r of newLabels) byRubric[r.rubric || "none"] = (byRubric[r.rubric || "none"] || 0) + 1;
console.log(`  rubric after merge: ${JSON.stringify(byRubric)}`);

if (WRITE) {
  writeJsonl(path.join(ML, "gold/labels.jsonl"), newLabels);
  console.log(`\nwritten.`);
} else {
  console.log(`\n(dry run — pass --write to apply)`);
}
