import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Title signals that strongly indicate an in-scope AI-engineering role.
// A match raises the prior to IN, but the encoder (which reads the description)
// can still veto it when confidently OUT — see the veto path in ingest.ts. That veto is what lets us keep broad signals like `agent` and the
// role/convention titles below without force-listing the odd non-eng posting
// (e.g. "Support Agent", a non-engineering MoTS).
export const IN_TITLE_PATTERNS: RegExp[] = [
  /\bai engineer\b/i,
  /\bgen.?ai\b/i,
  /\bgenerative ai\b/i,
  /\bllm\b/i,
  /\brag\b/i,
  /\bagent(s|ic)?\b/i,
  /\binference\b/i,
  /\bapplied ai\b/i,
  /\bforward.?deployed\b/i,
  /\bfine.?tun/i,
  /\beval(s|uation)?\b/i,
  /\bmodel serving\b/i,
  // Frontier-lab IC / research roles the bare keywords above miss. Safe to add
  // now that the model can veto a mis-match (above). Research scientists are IN
  // scope (AI/ML research); the model still filters non-IC "Research *Manager*".
  /\bresearch engineer\b/i,
  /\bresearch scientist\b/i,
  /\bmember of technical staff\b/i,
  /\bdeploy(ed|ment) engineer/i,
  /\bpost.?training\b/i,
  /\b(reinforcement learning|rlhf|dpo)\b/i,
];

// Hard-exclude signals (spec §4 OUT) even when "AI" appears somewhere.
export const OUT_TITLE_PATTERNS: RegExp[] = [
  /\bdata analyst\b/i,
  /\bbusiness intelligence\b/i,
  /\bsales\b/i,
  /\bmarketing\b/i,
  /\brecruiter\b/i,
  /\bdesigner\b/i,
  /\baccount executive\b/i,
  /\bproduct manager\b/i,
  /\boutcomes manager\b/i,
  // Catch-all postings, not a specific engineering role.
  /\b(open|spontaneous|general) application\b/i,
  /\btalent (pool|community|network)\b/i,
];

// Job families that are never AI engineering. Unlike OUT_TITLE_PATTERNS these are
// checked *after* IN_TITLE_PATTERNS (see classify.ts), so a title carrying a real
// AI signal always wins: "Technical Program Manager, Cloud Inference" and
// "Customer Support Engineer (Inference)" stay IN despite matching here.
//
// Every pattern below was mined from titles the LLM had already rejected and kept
// only where it was 100% OUT-pure against that labelled set — the whole point is
// to skip inference entirely, so a false positive here is a role silently lost. Prefer
// leaving a family out over guessing: `solutions architect/engineer` was dropped
// for exactly this reason (95.7% pure — it was killing infra-flavoured roles).
export const OFF_TOPIC_TITLE_PATTERNS: RegExp[] = [
  /\b(recruiting|recruitment|talent acquisition|people operations|hr business partner|onboarding specialist)\b/i,
  /\b(accountant|accounting|bookkeep|payroll|accounts payable|accounts receivable|controller|auditor|tax manager|fp&a|treasury)\b/i,
  /\b(counsel|paralegal|attorney|lawyer|compliance officer|legal (operations|manager|director))\b/i,
  /\b(nurse|nursing|physician|therapist|psychiatr|pharmac|dentist|caregiver|medical assistant|phlebotom|radiolog)\b/i,
  /\b(tutor|teacher|instructor|curriculum|professor|lecturer|trainer)\b/i,
  /\b(executive assistant|administrative assistant|office manager|receptionist|workplace experience|facilities)\b/i,
  /\b(customer success|customer support|support (agent|specialist|representative)|technical support|help desk|service desk)\b/i,
  /\b(technician|electrician|plumb|welder|machinist|crane operator|foreman|driver|warehouse|forklift|janitor|custodian)\b/i,
  /\b(supply chain|procurement|logistics|buyer|sourcing manager|inventory|fulfillment)\b/i,
  /\b(communications|public relations|copywriter|content (writer|manager|strategist)|social media|editor|journalist)\b/i,
  /\b(program manager|project manager|scrum master|delivery manager|chief of staff)\b/i,
  /\b(mechanical|electrical|civil|structural|chemical|manufacturing|industrial|aerospace) engineer\b/i,
  // Sales-adjacent titles the bare /sales/ above misses.
  /\bbusiness development\b/i,
  /\baccount manager\b/i,
  /\b(partnerships?|channel) (manager|lead|director)\b/i,
  // Non-English commercial/admin postings (fr/it/es/de/pt). These boards carry
  // whole localised sales and back-office ladders that never contain an AI role.
  // Note this also suppresses a genuinely French-language AI posting — revisit if
  // we ever want to list non-English roles.
  /\b(ingénieur|développeur|responsable|chargé|chargée|spécialiste|comptabilit|commercial(e|es)?|vendeur|stagiaire|alternance|conseiller|agente|commercio|venditore|contabil|ventas|comercial|desarrollador|vertrieb|kaufmann|kauffrau|mitarbeiter|buchhalt)\b/i,
];

// --- Published site ---------------------------------------------------------
// Must match site/astro.config.mjs (`site` + `base`). Used to turn job slugs
// into the absolute URLs we hand to search engines.
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://frontierroles.com";
// Empty now the site sits at its domain apex; kept so the URL builders below
// still compose if the board ever moves back under a path.
export const SITE_BASE = process.env.SITE_BASE ?? "";

// --- IndexNow ---------------------------------------------------------------
// Push notification of new/removed job URLs to Bing, Yandex, Naver and Seznam
// (Google does not participate — see the Indexing API for that side).
//
// The key is public by design: it only proves control of the host, and the
// matching file is served from site/public/<key>.txt — i.e. the domain root,
// which covers every URL we submit.
export const INDEXNOW_KEY =
  process.env.INDEXNOW_KEY ?? "baa66d54cf113d3258c04600e858975b";
export const INDEXNOW_ENDPOINT =
  process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";

// --- Google Indexing API ----------------------------------------------------
// Google's answer to IndexNow, which it doesn't participate in. It licenses the
// Indexing API for exactly two content types — JobPosting and BroadcastEvent —
// so a job board is the intended user, and a closed role can be pulled from
// Google Jobs the same night instead of waiting for a re-crawl.
//
// Two constraints shape everything below. Submitting a URL that carries no
// JobPosting markup is the documented way to lose API access, so notify.ts
// filters with shared/indexable.ts rather than announcing every open role. And
// unlike IndexNow's public host key, this one is a real credential: a service
// account private key, held in the GOOGLE_INDEXING_KEY secret and never logged.
//
// Accepts the JSON itself (how the GitHub Actions secret arrives) or a path to
// the downloaded key file (convenient when testing by hand). Unset = feature
// off, which is what every environment except the nightly runner wants.
export const GOOGLE_INDEXING_KEY = process.env.GOOGLE_INDEXING_KEY ?? "";

// Google's onboarding default is 200 publish requests per day per project, and
// URL_UPDATED and URL_DELETED both draw on it. Measured nightly churn is ~190
// at the board's current size, so the default is spent most nights — raise this
// to whatever the approved quota turns out to be. The daily allowance resets at
// midnight Pacific; the refresh cron lands mid-afternoon Pacific, so one run
// always draws on a single day's bucket.
// Read defensively: an unset GitHub Actions `vars.` reference expands to an
// empty string rather than disappearing, and Number("") is 0 — which would
// silently cap the run at nothing instead of falling back to the default.
const quotaEnv = process.env.GOOGLE_INDEXING_QUOTA?.trim();
const quotaOverride = quotaEnv ? Number(quotaEnv) : NaN;
export const GOOGLE_INDEXING_QUOTA =
  Number.isFinite(quotaOverride) && quotaOverride > 0 ? Math.floor(quotaOverride) : 200;

export const GOOGLE_INDEXING_ENDPOINT =
  process.env.GOOGLE_INDEXING_ENDPOINT ??
  "https://indexing.googleapis.com/v3/urlNotifications:publish";

// --- Classifier configuration -----------------------------------------------
// Classification runs locally: a fine-tuned ModernBERT encoder under ONNX
// Runtime (see pipeline/encoder.ts). No API key, no per-posting network call.
//
// Anchored to the repo root, NOT the working directory. `npm run -w
// @aiengjobs/engine` executes with cwd set to engine/, so a relative "ml/model"
// resolves to engine/ml/model and silently misses — which is exactly how a run
// once classified a whole ingest on title heuristics alone.
export const ENCODER_DIR =
  process.env.AIENGJOBS_ENCODER_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ml", "model");

// fp32, deliberately, despite int8 being a quarter the size. ONNX Runtime uses
// VPMADDUBSW for int8 matmuls on x86-64 AVX2/AVX512 without VNNI, which
// saturates: the same int8 graph that scores 0.9992 on an ARM Mac scored 0.6583
// on a GitHub runner, collapsing every decision toward 0.5. reduce_range=True
// mitigates it, but fp32 removes the failure mode rather than tuning it — and
// the 961MB droplet that forced quantisation is gone. Runners have 16GB.
export const ENCODER_FILE = process.env.AIENGJOBS_ENCODER_FILE ?? "model.onnx";

// MUST equal MAX_TOKENS in ml/train_encoder.py. The model was fine-tuned on
// adverts truncated at that length, so serving it a shorter window scores every
// longer advert off-distribution — on a question the cut text often answers.
// tests/trainInferenceParity.test.ts fails the build if the two drift apart.
// Read ml/TRAINING_INFERENCE_PARITY.md before touching this line.
//
// Deliberately NOT env-overridable. This is not a tuning knob: it is one half of
// a contract with the training run, and the other half is a committed constant.
//
// It was 1024 for the 961MB droplet, which could not hold the quadratic
// attention mask at 3072. That machine is gone and the runner has 16GB (this
// peaks at 2.5GB). 1024 truncated 70% of live adverts to ~80% of their text,
// and that silently moved decisions: one sampled advert scored 0.148 truncated
// against 0.971 whole — OUT and IN across the same 0.70 threshold. Honouring the
// training window costs 1.78x per advert on a representative sample.
export const ENCODER_WINDOW = 3072;

// Chosen from the held-out precision/recall curve, which knees here. Measured
// through the Node runtime at 0.70: 94.6% precision / 86.9% recall (92.0%
// precision reweighted to the 13% production base rate). Pushing to 0.87 buys
// ~1pp more precision for 13 more missed roles out of 183 — a bad exchange.
// Raise it if the board should be stricter still.
export const ENCODER_THRESHOLD = Number(process.env.AIENGJOBS_ENCODER_THRESHOLD ?? 0.7);

// Threads ONNX Runtime may use inside a single graph.
//
// This used to be pinned to 1, on the reasoning that the nightly run is a queue
// of independent adverts so parallelism belonged at the posting level. That
// premise does not hold: onnxruntime-node serialises concurrent run() calls on
// a session, so posting-level concurrency does not parallelise inference at all
// (measured: 8 adverts took 27.6s sequentially and 27.6s under Promise.all —
// 1.00x). Pinning to 1 therefore gave up intra-graph parallelism without buying
// anything, and left the 4-vCPU runner classifying on one core.
//
// Intra-op threads do scale, near-linearly, on a 1024-token advert:
//   1 thread 3.44s   2 threads 1.80s   4 threads 0.94s   8 threads 0.58s
//
// availableParallelism() honours the cgroup/affinity limits a runner or
// container imposes, so this tracks the cores actually granted rather than the
// cores the host happens to have.
//
// `||` rather than `??` because the value reaches a native API: a non-numeric
// or zero override falls back to the default instead of passing NaN into ORT.
export const ENCODER_THREADS = Math.max(
  1,
  Math.trunc(Number(process.env.AIENGJOBS_ENCODER_THREADS) || availableParallelism()),
);

// A heuristic IN title is only overturned when the model is at least this sure
// the role is OUT. Set conservatively so a stray "out" can't suppress a clear
// in-scope role; it exists to kill broad-keyword false-positives ("Support
// Agent" via /agent/), not to second-guess every title. See ingest.ts.
export const ENCODER_VETO_CONFIDENCE = 0.7;
