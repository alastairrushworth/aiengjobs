// Audits subagent output. The evidence quote must appear verbatim in the ad —
// that is the check that the label came from reading the advert rather than
// from the title. Also reports how deep into the ad the evidence was found,
// which is how we know the back half is actually being read.
const fs = require("fs");
const D = __dirname;
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

let rows = [], bad = [], depths = [];
for (const f of fs.readdirSync(`${D}/labels`).filter((f) => f.endsWith(".jsonl")).sort()) {
  const want = fs.readFileSync(`${D}/batches/${f.replace(".jsonl", ".txt")}`, "utf8").trim().split("\n");
  const got = [];
  for (const [i, line] of fs.readFileSync(`${D}/labels/${f}`, "utf8").trim().split("\n").entries()) {
    let r;
    try { r = JSON.parse(line); } catch { bad.push(`${f}:${i + 1} unparseable`); continue; }
    if (!r.id || !["in", "out"].includes(r.label)) { bad.push(`${f}:${i + 1} bad fields`); continue; }
    const p = `${D}/ads/${r.id}.txt`;
    if (!fs.existsSync(p)) { bad.push(`${f}: unknown id ${r.id}`); continue; }
    const ad = norm(fs.readFileSync(p, "utf8"));
    const ev = norm(r.evidence || "");
    const at = ev.length > 15 ? ad.indexOf(ev) : -2;
    if (at === -1) bad.push(`${f}: evidence not in ad — ${r.id} "${(r.evidence||"").slice(0,50)}"`);
    if (at >= 0) depths.push(at / ad.length);
    got.push(r.id);
    rows.push({ ...r, batch: f.replace(".jsonl", "") });
  }
  const missing = want.filter((id) => !got.includes(id));
  if (missing.length) bad.push(`${f}: missing ${missing.length} of ${want.length}`);
}
fs.writeFileSync(`${D}/labels-all.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const c = (k, v) => rows.filter((r) => r[k] === v).length;
console.log(`labelled: ${rows.length}   in=${c("label","in")} out=${c("label","out")}`);
console.log(`confidence: high=${c("confidence","high")} med=${c("confidence","med")} low=${c("confidence","low")}`);
console.log(`flagged ambiguous: ${rows.filter((r) => r.ambiguous === true).length}`);
depths.sort((a, b) => a - b);
if (depths.length) {
  const q = (p) => (100 * depths[Math.floor(depths.length * p)]).toFixed(0) + "%";
  console.log(`evidence position in ad: median ${q(.5)}, p75 ${q(.75)}, p90 ${q(.9)}  (deep = back half was read)`);
  console.log(`evidence found beyond the old 16% excerpt: ${(100 * depths.filter((d) => d > 0.16).length / depths.length).toFixed(0)}%`);
}
console.log(bad.length ? `\nPROBLEMS (${bad.length}):\n  ` + bad.slice(0, 15).join("\n  ") : "\nno problems found");
