/**
 * TF-IDF + logistic-regression baseline for the in/out classification.
 *
 * Trains on the COMPLETE job description. An earlier version used a stitched
 * ~900-character excerpt (first 300 chars + a responsibilities window + a
 * requirements window); that turned out to be ~16% of the average ad and cut
 * off exactly the requirements text where AI tooling is listed. Never reintroduce
 * a fixed-size slice here.
 *
 * Full text is ~6x the volume, so an explicit term->index vocabulary would hold
 * millions of bigram keys. We use the hashing trick instead: features hash into
 * a fixed 2^20 bucket space, which keeps memory flat regardless of corpus size.
 * Interpretability is recovered with a bounded second pass over titles only.
 *
 * Run: npx tsx ml/baseline.ts <train-full.jsonl> <index.jsonl> <gold-full.jsonl>
 */
import { readFileSync, writeFileSync } from "node:fs";

const BITS = 22;
const NBUCKETS = 1 << BITS;
const MASK = NBUCKETS - 1;

// --- features -------------------------------------------------------------

const STOP = new Set(
  ("the a an and or of to in for with on at by as is are be we you your our this that will from" +
    " have has can who all their its it they them if not but so such more most other than then a").split(/\s+/),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./ -]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && t.length < 30 && !STOP.has(t));
}

/** FNV-1a, folded into the bucket space. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & MASK;
}

/**
 * Title and body hash into separate namespaces — "engineer" in the title is a
 * different signal from "engineer" in a benefits paragraph. Bigrams carry the
 * discriminative units: "machine learning", "forward deployed", "account executive".
 */
function* featureBuckets(title: string, body: string): Generator<number> {
  for (const [ns, text] of [["t", title], ["b", body]] as const) {
    const ts = tokens(text);
    for (let i = 0; i < ts.length; i++) {
      yield hash(ns + ":" + ts[i]);
      if (i + 1 < ts.length) yield hash(ns + ":" + ts[i] + "_" + ts[i + 1]);
    }
  }
}

type Sparse = { idx: Int32Array; val: Float64Array };

function vectorise(title: string, body: string, idf: Float64Array): Sparse {
  const counts = new Map<number, number>();
  for (const b of featureBuckets(title, body)) counts.set(b, (counts.get(b) ?? 0) + 1);
  const idx = new Int32Array(counts.size);
  const val = new Float64Array(counts.size);
  let k = 0;
  let norm = 0;
  for (const [b, c] of counts) {
    const w = (1 + Math.log(c)) * idf[b];
    idx[k] = b;
    val[k] = w;
    norm += w * w;
    k++;
  }
  norm = Math.sqrt(norm) || 1;
  for (let j = 0; j < val.length; j++) val[j] /= norm;
  return { idx, val };
}

// --- model ----------------------------------------------------------------

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function score(w: Float64Array, b: number, x: Sparse): number {
  let z = b;
  for (let k = 0; k < x.idx.length; k++) z += w[x.idx[k]] * x.val[k];
  return sigmoid(z);
}

function train(X: Sparse[], y: Uint8Array, { epochs = 20, lr = 0.4, l2 = 2e-6 } = {}) {
  const w = new Float64Array(NBUCKETS);
  const g2 = new Float64Array(NBUCKETS);
  let b = 0;
  let b2 = 0;
  const pos = y.reduce((a: number, v) => a + v, 0);
  const wPos = (y.length - pos) / Math.max(pos, 1);
  const order = [...X.keys()];
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      const x = X[i];
      const sw = y[i] ? wPos : 1;
      const gBase = (score(w, b, x) - y[i]) * sw;
      for (let k = 0; k < x.idx.length; k++) {
        const f = x.idx[k];
        const g = gBase * x.val[k] + l2 * w[f];
        g2[f] += g * g;
        w[f] -= (lr / (Math.sqrt(g2[f]) + 1e-8)) * g;
      }
      b2 += gBase * gBase;
      b -= (lr / (Math.sqrt(b2) + 1e-8)) * gBase;
    }
  }
  return { w, b };
}

// --- metrics --------------------------------------------------------------

function prf(y: Uint8Array, p: number[], thr: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  p.forEach((v, i) => {
    const pred = v >= thr ? 1 : 0;
    if (pred && y[i]) tp++; else if (pred && !y[i]) fp++; else if (!pred && y[i]) fn++; else tn++;
  });
  const prec = tp / (tp + fp || 1), rec = tp / (tp + fn || 1);
  return { tp, fp, fn, tn, prec, rec, f1: (2 * prec * rec) / (prec + rec || 1) };
}
const pct = (x: number) => (100 * x).toFixed(1) + "%";
const report = (n: string, r: ReturnType<typeof prf>) =>
  console.log(`${n.padEnd(32)} TP=${String(r.tp).padStart(4)} FP=${String(r.fp).padStart(4)} FN=${String(r.fn).padStart(4)} TN=${String(r.tn).padStart(5)}  P=${pct(r.prec).padStart(6)} R=${pct(r.rec).padStart(6)} F1=${pct(r.f1).padStart(6)}`);

function bestThreshold(y: Uint8Array, p: number[]) {
  let best = { thr: 0.5, f1: -1 };
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const f1 = prf(y, p, t).f1;
    if (f1 > best.f1) best = { thr: t, f1 };
  }
  return best;
}

// --- data -----------------------------------------------------------------

const [trainPath, indexPath, goldPath] = process.argv.slice(2);
if (!trainPath || !indexPath || !goldPath) {
  console.error("Usage: npx tsx ml/baseline.ts <train-full.jsonl> <index.jsonl> <gold-full.jsonl>");
  process.exit(1);
}

const readJsonl = (p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const index = readJsonl(indexPath) as { id: string; title: string; cls: string }[];
const meta = new Map(index.map((r) => [r.id, r]));
const gold = readJsonl(goldPath) as { id: string; label: string; confidence: string; prev_cls: string; title: string; full: string }[];
const goldIds = new Set(gold.map((g) => g.id));

const docs: { id: string; title: string; body: string; y: number }[] = [];
for (const line of readFileSync(trainPath, "utf8").split("\n")) {
  if (!line) continue;
  const r = JSON.parse(line) as { id: string; full: string };
  const m = meta.get(r.id);
  if (!m || goldIds.has(r.id)) continue; // hold the gold set out entirely
  docs.push({ id: r.id, title: m.title, body: r.full, y: m.cls === "in" ? 1 : 0 });
}
console.log(`training docs: ${docs.length} (gold held out)  avg ${Math.round(docs.reduce((a, d) => a + d.body.length, 0) / docs.length)} chars\n`);

// --- idf over the full corpus, in bounded memory --------------------------
const df = new Int32Array(NBUCKETS);
for (const d of docs) {
  const seen = new Set<number>();
  for (const b of featureBuckets(d.title, d.body)) seen.add(b);
  for (const b of seen) df[b]++;
}
const idf = new Float64Array(NBUCKETS);
for (let i = 0; i < NBUCKETS; i++) idf[i] = Math.log((1 + docs.length) / (1 + df[i])) + 1;
const used = df.reduce((a: number, v) => a + (v > 0 ? 1 : 0), 0);
console.log(`hashed feature space: ${used} of ${NBUCKETS} buckets occupied (${pct(used / NBUCKETS)})\n`);

const X = docs.map((d) => vectorise(d.title, d.body, idf));
const y = Uint8Array.from(docs.map((d) => d.y));
const model = train(X, y);

const Xg = gold.map((g) => vectorise(g.title, g.full, idf));
const yg = Uint8Array.from(gold.map((g) => (g.label === "in" ? 1 : 0)));
const pg = Xg.map((x) => score(model.w, model.b, x));

console.log("=== Distil GPT-5.4-nano from FULL text, evaluate on gold ===");
report("student @0.5", prf(yg, pg, 0.5));
const bt = bestThreshold(yg, pg);
report(`student @${bt.thr.toFixed(2)} (best-F1)`, prf(yg, pg, bt.thr));
report("teacher (live system)", prf(yg, gold.map((g) => (g.prev_cls === "in" ? 1 : 0)), 0.5));

const hi = gold.map((g, i) => [g, pg[i]] as const).filter(([g]) => g.confidence === "high");
report("student, high-conf gold only", prf(
  Uint8Array.from(hi.map(([g]) => (g.label === "in" ? 1 : 0))), hi.map(([, p]) => p), bt.thr));

// Rows where the model most disagrees with my label — the labels worth re-reading.
console.log("\n=== Model/label disagreements, most confident first ===");
const dis = gold
  .map((g, i) => ({ g, p: pg[i], mine: g.label === "in" ? 1 : 0 }))
  .filter((d) => (d.p >= bt.thr ? 1 : 0) !== d.mine)
  .sort((a, b) => Math.abs(b.p - bt.thr) - Math.abs(a.p - bt.thr));
console.log(`${dis.length} disagreements (${dis.filter((d) => d.mine === 0).length} where the model says IN and I said OUT)`);
for (const d of dis.slice(0, 20)) {
  console.log(`  p=${d.p.toFixed(2)} model=${d.p >= bt.thr ? "IN " : "OUT"} mine=${d.g.label.toUpperCase().padEnd(3)} [${d.g.confidence}] ${d.g.title}`);
}
writeFileSync(
  trainPath.replace(/[^/]+$/, "") + "model-disagreements.json",
  JSON.stringify(dis.map((d) => ({ id: d.g.id, p: d.p, mine: d.g.label, conf: d.g.confidence }))),
);
