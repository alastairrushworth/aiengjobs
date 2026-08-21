// Split the gold set into review batches for the v4 relabel.
//
//   node ml/relabel/make-batches.cjs
//
// Writes ml/batches/v4gold-NN.txt (one advert id per line). The labels produced
// against them land in ml/labels/v4gold-NN.jsonl and are audited by
// ml/validate-labels.cjs, which checks every evidence quote appears verbatim in
// the advert — the check that a label came from reading rather than from the title.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const SIZE = 25;

const gold = fs.readFileSync(path.join(ML, "gold/gold.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

const missing = gold.filter((g) => !fs.existsSync(path.join(ML, "ads", `${g.id}.txt`)));
const usable = gold.filter((g) => fs.existsSync(path.join(ML, "ads", `${g.id}.txt`)));

fs.mkdirSync(path.join(ML, "batches"), { recursive: true });
fs.mkdirSync(path.join(ML, "labels"), { recursive: true });

let n = 0;
for (let i = 0; i < usable.length; i += SIZE) {
  n++;
  const name = `v4gold-${String(n).padStart(2, "0")}`;
  fs.writeFileSync(
    path.join(ML, "batches", `${name}.txt`),
    usable.slice(i, i + SIZE).map((g) => g.id).join("\n") + "\n",
  );
}

console.log(`gold rows: ${gold.length}  usable: ${usable.length}  batches: ${n} (size ${SIZE})`);
if (missing.length) {
  console.log(`\nno ad file — carried over unreviewed, flagged in the merge:`);
  for (const g of missing) console.log(`  ${g.id}  ${g.company} — ${g.title}  [${g.label}]`);
}
