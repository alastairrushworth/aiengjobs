// Where is the relabel up to?
//
//   node ml/relabel/status.cjs [prefix]
//
// Exists so the pass is resumable: it names the next batch to review rather than
// requiring anyone (or any session) to remember.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const prefix = process.argv[2] ?? "v4pos";

const batches = fs.readdirSync(path.join(ML, "batches"))
  .filter((f) => f.startsWith(prefix) && f.endsWith(".txt")).sort();
const done = new Set(
  fs.existsSync(path.join(ML, "labels"))
    ? fs.readdirSync(path.join(ML, "labels")).filter((f) => f.startsWith(prefix)).map((f) => f.replace(".jsonl", ""))
    : [],
);

const pending = batches.map((f) => f.replace(".txt", "")).filter((b) => !done.has(b));
const rowsDone = [...done].reduce(
  (n, b) => n + fs.readFileSync(path.join(ML, "labels", `${b}.jsonl`), "utf8").trim().split("\n").length, 0);
const rowsTotal = batches.reduce(
  (n, f) => n + fs.readFileSync(path.join(ML, "batches", f), "utf8").trim().split("\n").length, 0);

console.log(`${prefix}: ${done.size}/${batches.length} batches, ${rowsDone}/${rowsTotal} rows`);

if (done.size) {
  const all = [...done].flatMap((b) =>
    fs.readFileSync(path.join(ML, "labels", `${b}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const flipped = all.filter((r) => r.label === "out").length;
  console.log(`  confirmed IN: ${all.length - flipped}   flipped to OUT: ${flipped} (${(100 * flipped / all.length).toFixed(0)}%)`);
  console.log(`  ambiguous: ${all.filter((r) => r.ambiguous).length}`);
}
console.log(pending.length ? `next: ${pending[0]}` : `all batches labelled — run merge`);
