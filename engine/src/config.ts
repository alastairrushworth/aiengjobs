// Title signals that strongly indicate an in-scope AI-engineering role.
// A match raises the prior to IN, but the LLM (which reads the description) can
// still veto it when confidently OUT — see the "heuristic+llm-veto" path in
// ingest.ts. That veto is what lets us keep broad signals like `agent` and the
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
  // now that the LLM can veto a mis-match (above). Research scientists are IN
  // scope (AI/ML research); the LLM still filters non-IC "Research *Manager*".
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

// --- Published site ---------------------------------------------------------
// Must match site/astro.config.mjs (`site` + `base`). Used to turn job slugs
// into the absolute URLs we hand to search engines.
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://alastairrushworth.com";
export const SITE_BASE = process.env.SITE_BASE ?? "/aiengjobs";

// --- IndexNow ---------------------------------------------------------------
// Push notification of new/removed job URLs to Bing, Yandex, Naver and Seznam
// (Google does not participate — see the Indexing API for that side).
//
// The key is public by design: it only proves control of the host, and the
// matching file is served from site/public/<key>.txt. URLs we submit all sit
// under SITE_BASE, which is what lets the key live in a subdirectory.
export const INDEXNOW_KEY =
  process.env.INDEXNOW_KEY ?? "baa66d54cf113d3258c04600e858975b";
export const INDEXNOW_ENDPOINT =
  process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";

// --- LLM configuration ------------------------------------------------------
// On-the-fly classification/tagging uses OpenAI GPT-5.4-nano (cheapest).
export const LLM_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-nano";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// An ambiguous-title job is decided solely by the LLM; an "in" below this floor
// is classified OUT rather than listed. Low-confidence INs were letting junk
// through ("Open Application", rotation programs, generic SWE at 0.55–0.65).
export const LLM_IN_CONFIDENCE_FLOOR = 0.7;

// A heuristic IN title is only overturned when the LLM is at least this sure the
// role is OUT. Set conservatively so a stray LLM "out" can't suppress a clear
// in-scope role; it exists to kill broad-keyword false-positives ("Support
// Agent" via /agent/), not to second-guess every title. See ingest.ts.
export const LLM_VETO_CONFIDENCE = 0.7;
