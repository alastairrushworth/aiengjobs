// Print one review batch for labelling.
//
//   node ml/relabel/show-batch.cjs v4gold-01 [--full <id>]
//
// Prints each advert trimmed to the part that decides the call: the employer
// intro (which the domain test needs — "payroll company" vs "inference platform")
// and the responsibilities/requirements body. Boilerplate benefits and DEI tails
// are dropped. --full dumps one advert untrimmed when the trim is not enough.
const fs = require("fs");
const path = require("path");

const ML = path.join(__dirname, "..");
const name = process.argv[2];
const fullIdx = process.argv.indexOf("--full");
const fullId = fullIdx > -1 ? process.argv[fullIdx + 1] : null;

const gold = new Map(
  fs.readFileSync(path.join(ML, "gold/gold.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l)).map((g) => [g.id, g]),
);

const read = (id) => fs.readFileSync(path.join(ML, "ads", `${id}.txt`), "utf8");

if (fullId) {
  console.log(read(fullId));
  process.exit(0);
}

const ids = fs.readFileSync(path.join(ML, "batches", `${name}.txt`), "utf8").trim().split("\n");

// Where the role actually starts being described.
const ROLE_START =
  /(what you.ll do|what you will do|responsibilities|key responsibilities|the role|about the role|in this role|you will|impact you will|what you.ll contribute|your role|role overview|job description|position overview)/i;
// Where it stops being worth reading.
const TAIL =
  /(equal opportunity|we are an equal|benefits|perks|our values|compensation range|salary range|what we offer|diversity|accommodation|privacy notice|about us\b)/i;

const BUDGET = 2300;

for (const id of ids) {
  const g = gold.get(id);
  const raw = read(id);
  // Strip the serialisation header; keep the metadata for display.
  const body = raw.replace(/^[\s\S]*?FULL JOB ADVERT \(verbatim, untruncated\):\n/, "");

  const start = body.search(ROLE_START);
  const intro = body.slice(0, 420).replace(/\s+/g, " ").trim();
  let core;
  if (start > -1) {
    const rest = body.slice(start);
    const tail = rest.slice(200).search(TAIL);
    core = tail > -1 ? rest.slice(0, 200 + tail) : rest;
  } else {
    core = body;
  }
  core = core.slice(0, BUDGET).replace(/\n{2,}/g, "\n").trim();

  console.log(`\n${"=".repeat(78)}`);
  console.log(`ID: ${id}`);
  console.log(`${g.company} — ${g.title}   [${g.location ?? "?"}]`);
  console.log(`prev: ${g.label} (${g.confidence})  stratum=${g.stratum}  reason: ${g.reason}`);
  console.log(`adv chars: ${body.length}${start === -1 ? "  (no responsibilities marker found)" : ""}`);
  console.log("-".repeat(78));
  if (start > 420) console.log(`[INTRO] ${intro}\n`);
  console.log(core);
  if (core.length >= BUDGET) console.log(`\n[...trimmed, ${body.length} chars total — use --full ${id} if undecided]`);
}
console.log(`\n${"=".repeat(78)}\n${ids.length} adverts in ${name}`);
