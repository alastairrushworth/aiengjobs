// Mechanical pass over snapshot.json for the audit-data skill — the part a
// script can do. Reads the published snapshot only; never the DB, never the
// network. No dependencies.
//
//   node .claude/skills/audit-data/scripts/profile.mjs                 # profile + flags
//   node .claude/skills/audit-data/scripts/profile.mjs --sample 40     # + a stratified sample
//   node .claude/skills/audit-data/scripts/profile.mjs --sample 40 --seed 7 --company adobe
//   node .claude/skills/audit-data/scripts/profile.mjs --json          # machine-readable
//
// Flags are CANDIDATES, not findings. Each one is cheap to raise and some are
// legitimate (a Workday tenant really is called "external"); the skill's
// Step 2 is where a person — you — reads the source posting and decides.
//
// The sample is stratified by ATS family × classifier band so a 40-role check
// is not 40 Ashby postings: Ashby alone is a third of the board, and the
// families fail in different ways. Same --seed, same snapshot → same sample,
// so a re-check after a fix reads the same roles.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const PATH = opt("snapshot", "site/src/data/snapshot.json");
const SAMPLE = Number(opt("sample", 0));
const SEED = Number(opt("seed", 1));
const COMPANY = opt("company", null);
// engine/src/config.ts ENCODER_THRESHOLD, repo.ts UNSEEN_CLOSE_DAYS,
// shared/indexable.ts MAX_JOB_AGE_DAYS. Mirrored, not imported, so this runs
// with plain `node` — check them against the source if a flag count jumps.
const THRESHOLD = Number(opt("threshold", 0.7));
const UNSEEN_CLOSE_DAYS = 14;
const MAX_JOB_AGE_DAYS = 90;
const EXAMPLES = 6;

const snap = JSON.parse(readFileSync(PATH, "utf8"));
const now = new Date(snap.generatedAt).getTime();
const days = (iso) => (now - new Date(iso).getTime()) / 864e5;
const open = snap.jobs.filter((j) => !j.isClosed && !j.isDelisted);
// What the site lists: open, dated, inside the age window (shared/indexable.ts
// listedJobs). Open roles past 90 days are tombstones by design — the nightly
// run still re-verifies them — so they are counted, never flagged or sampled.
const listed = open.filter((j) => j.postedAt && days(j.postedAt) <= MAX_JOB_AGE_DAYS);
const scoped = COMPANY ? listed.filter((j) => j.companySlug.includes(COMPANY)) : listed;

function family(url) {
  let h;
  try { h = new URL(url).hostname; } catch { return "bad-url"; }
  const known = [
    ["ashbyhq.com", "ashby"], ["greenhouse.io", "greenhouse"], ["lever.co", "lever"],
    ["smartrecruiters.com", "smartrecruiters"], ["myworkdayjobs.com", "workday"],
    ["oraclecloud.com", "oracle"], ["icims.com", "icims"], ["eightfold.ai", "eightfold"],
    ["successfactors", "successfactors"], ["teamtailor.com", "teamtailor"],
    ["recruitee.com", "recruitee"], ["bamboohr.com", "bamboohr"],
    ["personio", "personio"], ["workable.com", "workable"],
  ];
  for (const [needle, name] of known) if (h.includes(needle)) return name;
  return "custom-domain"; // employer's own careers site fronting some ATS
}
// "title-rescued": the model scored it under the threshold, but the title
// matched IN_TITLE_PATTERNS and the model was not confident enough to veto
// (ingest.ts: veto needs 1 - p >= ENCODER_VETO_CONFIDENCE). The richest
// stratum for precision errors. "no-score": no modelScore on the row — most
// likely ingested before the field existed and not re-inferred since.
const band = (s) =>
  s == null ? "no-score" : s < THRESHOLD ? "title-rescued" : s < THRESHOLD + 0.1 ? "boundary" : "confident";

// ── Profile ─────────────────────────────────────────────────────────────────
const coverage = {};
for (const f of ["descriptionText", "country", "city", "seniority", "modelScore", "salaryMin", "postedAt", "lastSeenAt", "region"])
  coverage[f] = `${((100 * scoped.filter((j) => j[f] != null && j[f] !== "").length) / scoped.length).toFixed(1)}%`;
const byFamily = {};
for (const j of scoped) byFamily[family(j.applyUrl)] = (byFamily[family(j.applyUrl)] ?? 0) + 1;
const byBand = {};
for (const j of scoped) byBand[band(j.modelScore)] = (byBand[band(j.modelScore)] ?? 0) + 1;

// ── Flags ───────────────────────────────────────────────────────────────────
const flags = {};
const flag = (name, j, note) => {
  (flags[name] ??= []).push({ slug: j.slug, company: j.companyName ?? j.name, note });
};

// Company slugs lifted from an ATS host or tenant path become public URLs
// (/companies/adobe-wd5-external-experienced/). Found 59 of 924 on 2026-09-23.
for (const c of snap.companies)
  if (/-wd\d+-|oraclecloud|saasfaprod|^fa-|-external(?:-|$)|^careers?-|-careers?$|icims|eightfold/.test(c.slug))
    if (!COMPANY || c.slug.includes(COMPANY)) flag("company-slug-from-ats-host", { slug: c.slug, name: c.name }, `/companies/${c.slug}/`);

const fxKnown = new Set(Object.keys(snap.fxRates ?? {}));
for (const j of scoped) {
  const t = j.title ?? "";
  if (/&(?:#\d+|#x[0-9a-f]+|amp|quot|lt|gt|nbsp);|<\/?[a-z]/i.test(t)) flag("title-markup-or-entity", j, t);
  if (/\b(?:R|JR|REQ)[-_ ]?\d{4,}\b|\(\d{5,}\)|\s[-–|]\s*(?:remote|hybrid|onsite|[A-Z][a-z]+,\s*[A-Z]{2})\s*$/i.test(t))
    flag("title-carries-reqid-or-location", j, t);
  if (t.length > 12 && t === t.toUpperCase() && /[A-Z]/.test(t)) flag("title-all-caps", j, t);

  if (j.salaryMin != null) {
    if (j.salaryMax != null && j.salaryMin > j.salaryMax) flag("salary-min-gt-max", j, `${j.salaryMin}>${j.salaryMax}`);
    if (j.salaryPeriod === "year" && (j.salaryMax ?? j.salaryMin) < 10_000) flag("salary-annual-implausibly-low", j, `${j.salaryMin}-${j.salaryMax} ${j.salaryCurrency}/yr`);
    if (j.salaryPeriod === "hour" && j.salaryMin > 1_000) flag("salary-hourly-implausibly-high", j, `${j.salaryMin} ${j.salaryCurrency}/hr`);
    if (j.salaryCurrency && !fxKnown.has(j.salaryCurrency)) flag("salary-currency-not-in-fx", j, j.salaryCurrency);
  }

  if (days(j.postedAt) < -1) flag("posted-in-future", j, j.postedAt);
  if (j.lastSeenAt && days(j.lastSeenAt) > UNSEEN_CLOSE_DAYS) flag("open-but-unseen", j, `last seen ${j.lastSeenAt}`);

  if (!j.country && j.locationRaw && !/^\s*remote\s*$/i.test(j.locationRaw)) flag("no-country-despite-location", j, j.locationRaw);
  if (j.city && j.locationRaw && !j.locationRaw.toLowerCase().includes(j.city.toLowerCase().split(" ")[0]))
    flag("city-not-in-location-string", j, `${j.city} ← "${j.locationRaw}"`);

  if (!/^https:\/\//.test(j.applyUrl)) flag("apply-url-not-https", j, j.applyUrl);
  if (/linkedin\.com|indeed\.|glassdoor\.|ziprecruiter\.|monster\./i.test(j.applyUrl)) flag("apply-url-aggregator", j, j.applyUrl);
  if (!j.descriptionText) flag("open-without-description", j, family(j.applyUrl));
}

// Exact copies (same title + company + locationRaw) are consolidated onto the
// newest by duplicateOfIn (shared/indexable.ts) — by design, not flagged. What
// escapes that key is the same role with a differently spelled location
// ("Bengaluru, India" / "Bangalore") or title case: same company, normalised
// title and canonical city, but more than one consolidation key.
const groups = new Map();
for (const j of scoped) {
  if (!j.city) continue; // no city = nothing to compare; would lump Copenhagen with London
  const k = `${j.companySlug}|${j.normalizedTitle}|${j.city.toLowerCase()}`;
  groups.set(k, [...(groups.get(k) ?? []), j]);
}
for (const [, g] of groups) {
  const keys = new Set(g.map((j) => [j.title, j.companySlug, j.locationRaw ?? ""].join(" ")));
  if (keys.size > 1) flag("near-duplicate-escapes-consolidation", g[0], `${keys.size} keys: ${[...new Set(g.map((j) => j.locationRaw))].slice(0, 3).join(" | ")}`);
}

// ── Sample ──────────────────────────────────────────────────────────────────
let rng = SEED >>> 0 || 1;
const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function stratifiedSample(jobs, n) {
  const strata = new Map();
  for (const j of jobs) {
    const k = `${family(j.applyUrl)}/${band(j.modelScore)}`;
    strata.set(k, [...(strata.get(k) ?? []), j]);
  }
  for (const list of strata.values())
    for (let i = list.length - 1; i > 0; i--) {
      const r = Math.floor(rand() * (i + 1));
      [list[i], list[r]] = [list[r], list[i]];
    }
  // Round-robin across strata, sorted for determinism: every family and band
  // gets represented before any gets a second pick.
  const keys = [...strata.keys()].sort();
  const out = [];
  for (let round = 0; out.length < n; round++) {
    let took = false;
    for (const k of keys) {
      const j = strata.get(k)[round];
      if (j && out.length < n) { out.push({ stratum: k, j }); took = true; }
    }
    if (!took) break;
  }
  return out;
}
const sample = SAMPLE > 0 ? stratifiedSample(scoped, SAMPLE) : [];

// ── Output ──────────────────────────────────────────────────────────────────
// No process.exit() after the JSON write: it truncates stdout when piped.
if (args.includes("--json")) {
  console.log(JSON.stringify({ generatedAt: snap.generatedAt, open: open.length, listed: scoped.length, coverage, byFamily, byBand, flags,
    sample: sample.map(({ stratum, j }) => ({ stratum, slug: j.slug, score: j.modelScore, company: j.companyName, title: j.title, applyUrl: j.applyUrl })) }, null, 2));
} else {
const age = ((Date.now() - now) / 864e5).toFixed(1);
console.log(`snapshot ${snap.generatedAt} (${age} days old) · ${snap.jobs.length} jobs · ${open.length} open · ${listed.length} listed (${open.length - listed.length} open but past ${MAX_JOB_AGE_DAYS} days or undated — unlisted by design)${COMPANY ? ` · ${scoped.length} listed matching "${COMPANY}"` : ""} · ${snap.companies.length} companies`);
console.log(`\nfield coverage (listed): ${Object.entries(coverage).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`ATS family: ${Object.entries(byFamily).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`classifier band (threshold ${THRESHOLD}): ${Object.entries(byBand).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`\nflags — candidates, not findings:`);
for (const [name, list] of Object.entries(flags).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(5)}  ${name}`);
  for (const f of list.slice(0, EXAMPLES)) console.log(`         ${f.company} · ${f.slug} · ${String(f.note).slice(0, 110)}`);
}
if (sample.length) {
  console.log(`\nsample (${sample.length}, seed ${SEED}):`);
  for (const { stratum, j } of sample)
    console.log(`  ${stratum.padEnd(34)} ${(j.modelScore ?? "—").toString().slice(0, 4).padEnd(5)} ${j.companyName} · ${j.title}\n  ${"".padEnd(40)}${j.slug}\n  ${"".padEnd(40)}${j.applyUrl}`);
}
}
