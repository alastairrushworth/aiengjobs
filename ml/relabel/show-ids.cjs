// Render an arbitrary set of adverts for re-reading, same shape as show-batch.cjs.
//
//   node ml/relabel/show-ids.cjs <file-of-ids>            trimmed to the deciding part
//   node ml/relabel/show-ids.cjs <file-of-ids> --full     untruncated
//
// Used for the v4.1 re-audit, where the rows to re-read are selected by rule
// rather than by batch.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const BUDGET = 2300;
const FULL = process.argv.includes("--full");
const idsFile = process.argv[2];

const readJsonl = (p) =>
  fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const labels = new Map(readJsonl(path.join(ML, "gold/labels.jsonl")).map((r) => [r.id, r]));
const ids = fs.readFileSync(idsFile, "utf8").trim().split("\n").map((s) => s.trim()).filter(Boolean);

// Skip the boilerplate intro and start at the responsibilities where we can find them.
const MARKERS = [
  /\n[^\n]{0,60}(what you.{0,3}ll do|what you will do|responsibilities|key responsibilities|in this role|about the role|the role|your impact|you will:|role overview)[^\n]{0,40}\n/i,
];

for (const id of ids) {
  const row = labels.get(id);
  const adPath = path.join(ML, "ads", id + ".txt");
  if (!fs.existsSync(adPath)) { console.log(`\n!! missing ad: ${id}`); continue; }
  const ad = fs.readFileSync(adPath, "utf8");

  console.log("\n" + "=".repeat(78));
  console.log(`ID: ${id}`);
  console.log(`${row.company} — ${row.title}`);
  console.log(`current: ${row.label} (${row.confidence}) [${row.rubric}]${row.prev_label ? `  was: ${row.prev_label}` : ""}`);
  console.log(`reason: ${(row.reason || "").slice(0, 260)}`);
  console.log(`adv chars: ${ad.length}`);
  console.log("-".repeat(78));

  if (FULL || ad.length <= BUDGET) { console.log(ad.trim()); continue; }

  let start = 0;
  for (const m of MARKERS) {
    const hit = ad.match(m);
    if (hit && hit.index < ad.length * 0.6) { start = hit.index; break; }
  }
  if (start > 0) console.log(`[INTRO SKIPPED] ${ad.slice(0, 300).replace(/\s+/g, " ").trim()}\n`);
  console.log(ad.slice(start, start + BUDGET).trim());
  if (start + BUDGET < ad.length) console.log(`\n[...trimmed, ${ad.length} chars total — use --full for the rest]`);
}
console.log(`\n${ids.length} adverts`);
