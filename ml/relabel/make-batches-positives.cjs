// Second relabel pass: the positive class that v4 has not seen.
//
//   node ml/relabel/make-batches-positives.cjs
//
// The gold pass measured the error rate by class: 22% of IN rows were wrong
// against v4, against 1.6% of OUT rows. So this pass audits only the IN rows
// still carrying a pre-v4 rubric — auditing the 3,800 stale negatives would cost
// eight times as much for a fortieth of the corrections.
//
// Batches are grouped by company so near-duplicate reposts land together and get
// the same call, and so a batch reads as one employer context rather than 25.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const SIZE = 25;

const rows = fs.readFileSync(path.join(ML, "gold/labels.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

const stale = rows.filter((r) => r.label === "in" && r.rubric !== "v4");
const missing = stale.filter((r) => !fs.existsSync(path.join(ML, "ads", `${r.id}.txt`)));
const usable = stale.filter((r) => fs.existsSync(path.join(ML, "ads", `${r.id}.txt`)));

// Company-major, then title, so reposts are adjacent.
usable.sort((a, b) =>
  (a.company ?? "").localeCompare(b.company ?? "") || (a.title ?? "").localeCompare(b.title ?? ""));

fs.mkdirSync(path.join(ML, "batches"), { recursive: true });
let n = 0;
for (let i = 0; i < usable.length; i += SIZE) {
  n++;
  fs.writeFileSync(
    path.join(ML, "batches", `v4pos-${String(n).padStart(2, "0")}.txt`),
    usable.slice(i, i + SIZE).map((r) => r.id).join("\n") + "\n",
  );
}

console.log(`stale IN rows: ${stale.length}  usable: ${usable.length}  batches: ${n} (size ${SIZE})`);
if (missing.length) {
  console.log(`no ad file (skipped): ${missing.length}`);
  for (const r of missing) console.log(`  ${r.id}  ${r.company} — ${r.title}`);
}
const byRubric = {};
for (const r of usable) byRubric[r.rubric] = (byRubric[r.rubric] ?? 0) + 1;
console.log(`by rubric: ${JSON.stringify(byRubric)}`);
