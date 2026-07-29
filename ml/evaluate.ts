// Score the live heuristic+GPT-5.4-nano classifier against the hand-labelled
// gold set. Rows drawn by the unstratified top-up are folded back into their
// true stratum, so weights are a clean post-stratified estimator of the
// 42,249-posting population.
import { readFileSync } from "node:fs";
import {
  IN_TITLE_PATTERNS,
  OFF_TOPIC_TITLE_PATTERNS,
  OUT_TITLE_PATTERNS,
} from "/Users/alastairrushworth/Documents/GitHub/aiengjobs/engine/src/config.ts";

const DIR = process.argv[2] ?? ".";  // dir holding gold.jsonl and index.jsonl
const gold = readFileSync(`${DIR}/gold.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const index = readFileSync(`${DIR}/index.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));

function stratum(title: string): string {
  if (OUT_TITLE_PATTERNS.some((re) => re.test(title))) return "heur_out";
  if (IN_TITLE_PATTERNS.some((re) => re.test(title))) return "heur_in";
  if (OFF_TOPIC_TITLE_PATTERNS.some((re) => re.test(title))) return "offtopic_out";
  return "ambiguous";
}
const band = (c: number | null) => {
  const v = c ?? 0;
  return v < 0.5 ? "lo" : v < 0.7 ? "sub_floor" : v < 0.85 ? "boundary" : "confident";
};
const cell = (title: string, conf: number | null) => {
  const s = stratum(title);
  return s === "ambiguous" ? `ambiguous/${band(conf)}` : s;
};

// Population size of each post-stratification cell.
const popSize: Record<string, number> = {};
for (const r of index) popSize[cell(r.title, r.conf)] = (popSize[cell(r.title, r.conf)] ?? 0) + 1;

// Sample count per cell (random top-ups folded in).
const sampled: Record<string, number> = {};
for (const g of gold) sampled[cell(g.title, g.prev_conf)] = (sampled[cell(g.title, g.prev_conf)] ?? 0) + 1;

// --- unweighted confusion -------------------------------------------------
type Row = { g: string; p: string; w: number; cell: string };
const rows: Row[] = gold.map((g) => {
  const c = cell(g.title, g.prev_conf);
  return { g: g.label, p: g.prev_cls, w: popSize[c] / sampled[c], cell: c };
});

function score(rs: Row[], weighted: boolean) {
  const w = (r: Row) => (weighted ? r.w : 1);
  const tp = rs.filter((r) => r.g === "in" && r.p === "in").reduce((a, r) => a + w(r), 0);
  const fp = rs.filter((r) => r.g === "out" && r.p === "in").reduce((a, r) => a + w(r), 0);
  const fn = rs.filter((r) => r.g === "in" && r.p === "out").reduce((a, r) => a + w(r), 0);
  const tn = rs.filter((r) => r.g === "out" && r.p === "out").reduce((a, r) => a + w(r), 0);
  const prec = tp / (tp + fp);
  const rec = tp / (tp + fn);
  return { tp, fp, fn, tn, prec, rec, f1: (2 * prec * rec) / (prec + rec), acc: (tp + tn) / (tp + fp + fn + tn) };
}

const pct = (x: number) => (100 * x).toFixed(1) + "%";
const show = (name: string, s: ReturnType<typeof score>, dp = 0) =>
  console.log(
    `${name.padEnd(26)} TP=${s.tp.toFixed(dp).padStart(7)} FP=${s.fp.toFixed(dp).padStart(7)} FN=${s.fn.toFixed(dp).padStart(7)} TN=${s.tn.toFixed(dp).padStart(7)}  P=${pct(s.prec).padStart(6)} R=${pct(s.rec).padStart(6)} F1=${pct(s.f1).padStart(6)}`,
  );

console.log("=== Current system (heuristics + GPT-5.4-nano) vs gold ===\n");
show("sample (unweighted)", score(rows, false));
const conf = gold.map((g) => g.confidence);
show("  high-confidence only", score(rows.filter((_, i) => conf[i] === "high"), false));
show("  excl. low-confidence", score(rows.filter((_, i) => conf[i] !== "low"), false));

console.log("\n--- reweighted to the 42,249-posting population ---");
show("population estimate", score(rows, true), 0);

console.log("\n--- per stratum (unweighted counts) ---");
console.log("cell                       pop  sampled  gold_in  FP  FN");
for (const c of Object.keys(popSize).sort()) {
  const rs = rows.filter((r) => r.cell === c);
  const s = score(rs, false);
  console.log(
    `${c.padEnd(22)} ${String(popSize[c]).padStart(6)} ${String(sampled[c] ?? 0).padStart(8)} ${String(rs.filter((r) => r.g === "in").length).padStart(8)} ${String(s.fp).padStart(3)} ${String(s.fn).padStart(3)}`,
  );
}

console.log("\n--- disagreements ---");
for (const [i, g] of gold.entries()) {
  if (g.label !== g.prev_cls) {
    const kind = g.label === "in" ? "MISSED (gold in, live out)" : "WRONGLY LISTED (gold out, live in)";
    console.log(`  ${kind} [${g.confidence}] ${g.company} — ${g.title}  (${rows[i].cell}, conf ${g.prev_conf})`);
  }
}
