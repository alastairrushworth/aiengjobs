import { SENIORITIES } from "@aiengjobs/shared";
import type { JobEntry } from "./jobEntry.ts";

/**
 * Everything the listing filter knows how to do, with no DOM in it.
 *
 * This used to live inside the `<script>` in components/JobFilters.astro, which
 * meant the one part of the site a visitor interacts with most was also the one
 * part no test could reach. It had been quietly wrong for a while: the query
 * was compiled to a single regex and tested against a concatenation of the
 * job's fields, so the terms had to appear *adjacently, in that order*, in that
 * concatenation. "senior rag" returned 0 of 152; "remote python" 0 of 159;
 * "staff ai engineer" 13 of 107. Two-word queries are how people search a job
 * board, and most of them returned an empty screen.
 *
 * The module is deliberately pure: the client owns the DOM, this owns what
 * "matches" means. tests/search.test.ts covers it.
 */

/** Work-type options, in the order the control shows them. */
export const WORK_OPTIONS = [
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
] as const;

/**
 * Grouped seniority value. "Senior or above" is the most common thing anyone
 * wants to say about level, and a one-of-eight select is the one shape that
 * can't say it — you could ask for Senior or Staff or Principal, never the
 * band. Everything at or past `senior` on the shared ladder, so the group
 * tracks the ladder rather than restating it.
 */
export const SENIOR_PLUS = "senior+";
export const SENIOR_PLUS_IDS: readonly string[] = SENIORITIES.slice(
  SENIORITIES.indexOf("senior"),
);

/** Expand a `level` value to the seniority ids it selects. */
export function expandLevel(level: string): readonly string[] {
  if (!level) return [];
  return level === SENIOR_PLUS ? SENIOR_PLUS_IDS : [level];
}

/**
 * Terms that should also match something they aren't spelled like.
 *
 * Only single tokens, and only where the mapping is a fact rather than a guess:
 * "nyc" is New York, "k8s" is Kubernetes. Deliberately no geography wider than
 * a city — "bay area" isn't San Francisco, and a synonym table that pretends
 * otherwise silently returns the wrong roles rather than none.
 */
const ALIASES: Record<string, string[]> = {
  ai: ["ai", "artificial intelligence"],
  ml: ["ml", "machine learning"],
  mle: ["mle", "machine learning engineer"],
  llm: ["llm", "large language model"],
  llms: ["llm", "large language model"],
  nlp: ["nlp", "natural language"],
  cv: ["cv", "computer vision"],
  rl: ["rl", "reinforcement learning"],
  genai: ["genai", "generative ai"],
  gpu: ["gpu", "cuda"],
  k8s: ["k8s", "kubernetes"],
  js: ["js", "javascript"],
  ts: ["ts", "typescript"],
  golang: ["golang", "go"],
  postgres: ["postgres", "postgresql"],
  nyc: ["nyc", "new york"],
  sf: ["sf", "san francisco"],
  sfo: ["sfo", "san francisco"],
  bengaluru: ["bengaluru", "bangalore"],
  bangalore: ["bangalore", "bengaluru"],
  wfh: ["wfh", "remote"],
  finetuning: ["finetuning", "fine-tun", "fine tun"],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The spellings a single typed term should match. */
function variants(term: string): string[] {
  const out = new Set(ALIASES[term] ?? [term]);
  // Matching is prefix-anchored, so "agent" already finds "agents". This is the
  // other direction: someone who types the plural still finds the singular.
  if (term.length > 3 && term.endsWith("s")) out.add(term.slice(0, -1));
  return [...out];
}

/**
 * Compile a query into one matcher per whitespace-separated term. All of them
 * have to match — that is the whole fix. Each is anchored to a word start, so
 * "rust" still doesn't match "Trustpilot", but a term starting with punctuation
 * (".net", "c++") skips the anchor, where `\b` would mean the opposite.
 */
export function buildTerms(query: string): RegExp[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => {
      const alts = variants(term).map(escapeRe).join("|");
      return new RegExp(`${/^\w/.test(term) ? "\\b" : ""}(?:${alts})`);
    });
}

/**
 * The text a query is tested against, built once per job and cached on it.
 *
 * Wider than it was: city, seniority label and work-type label are in here now,
 * so "senior", "hybrid" and "bangalore" are things you can simply type. The
 * description is not — it's on 99.9% of roles and would multiply the payload by
 * an order of magnitude for a fetch that already blocks the first keystroke.
 */
export function searchBlob(j: JobEntry): string {
  return (j.q ??= [j.t, j.c, j.sk.join(" "), j.l, j.ci, j.sl, j.r]
    .filter(Boolean)
    .join(" ")
    .toLowerCase());
}

/**
 * How well a job answers the query, so "python" doesn't just return 1,345 roles
 * in date order. A term found in the title says more than the same term found
 * in a skill tag every third role carries.
 */
export function relevance(j: JobEntry, terms: RegExp[]): number {
  if (!terms.length) return 0;
  const title = j.t.toLowerCase();
  const company = j.c.toLowerCase();
  const skills = j.sk.join(" ").toLowerCase();
  let score = 0;
  for (const re of terms) {
    if (re.test(title)) score += 3;
    else if (re.test(company)) score += 2;
    else if (re.test(skills)) score += 1;
  }
  return score;
}

export interface FilterState {
  q: string;
  level: string;
  country: string;
  city: string;
  work: string;
  /** Exact skill matches, ANDed. Set from card badges, /stats and landings. */
  skills: string[];
}

export const EMPTY_STATE: FilterState = {
  q: "",
  level: "",
  country: "",
  city: "",
  work: "",
  skills: [],
};

export function isFiltering(s: FilterState): boolean {
  return Boolean(
    s.q.trim() ||
      s.level ||
      s.country ||
      s.city ||
      s.work ||
      s.skills.length,
  );
}

/**
 * One clause per control, keyed by the control's id.
 *
 * The list applies all of them; the option counts drop exactly one at a time,
 * which is what makes "United Kingdom (170)" mean "and how many if I pick this
 * one" rather than "how many ignoring everything you've already chosen".
 */
export function buildTests(s: FilterState): Record<string, (j: JobEntry) => boolean> {
  const terms = buildTerms(s.q.trim());
  const levels = expandLevel(s.level);
  return {
    q: (j) => terms.every((re) => re.test(searchBlob(j))),
    country: (j) => !s.country || j.co === s.country,
    city: (j) => !s.city || j.ci === s.city,
    level: (j) => !levels.length || levels.includes(j.sn),
    work: (j) => !s.work || j.rm === s.work,
    skill: (j) => s.skills.every((sk) => j.sk.includes(sk)),
  };
}

/** Matching jobs, most relevant first when there's a query and newest-first otherwise. */
export function filterJobs(data: JobEntry[], s: FilterState): JobEntry[] {
  const tests = Object.values(buildTests(s));
  const matches = data.filter((j) => tests.every((fn) => fn(j)));
  const terms = buildTerms(s.q.trim());
  if (!terms.length) return matches;
  // Decorated sort so ties keep the incoming order — which is newest-first, and
  // is the tiebreak anyone would want among equally relevant roles.
  return matches
    .map((j, i) => ({ j, i, score: relevance(j, terms) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.j);
}

/** Pseudo-key for "drop the last word of the query" (see `relaxations`). */
export const QUERY_TRIM = "q-trim";

/** Every filter currently narrowing the list, as separately removable units. */
export function activeFilters(s: FilterState): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (s.q.trim()) out.push({ key: "q", value: s.q.trim() });
  for (const key of ["level", "country", "city", "work"] as const) {
    if (s[key]) out.push({ key, value: s[key] });
  }
  for (const sk of s.skills) out.push({ key: "skill", value: sk });
  return out;
}

/** The same state with one filter lifted. */
export function without(s: FilterState, key: string, value = ""): FilterState {
  switch (key) {
    case "q":
      return { ...s, q: "" };
    case QUERY_TRIM: {
      const words = s.q.trim().split(/\s+/).filter(Boolean);
      return { ...s, q: words.slice(0, -1).join(" ") };
    }
    case "skill":
      return { ...s, skills: s.skills.filter((x) => x !== value) };
    case "level":
    case "country":
    case "city":
    case "work":
      return { ...s, [key]: "" };
    default:
      return s;
  }
}

export interface Relaxation {
  key: string;
  value: string;
  count: number;
  state: FilterState;
}

/**
 * Ways out of an empty result set, best first.
 *
 * A board that answers "no roles match those filters" and stops is asking the
 * visitor to guess which of six things they set was the mistake. Every one of
 * these is a single click that is known to return something, because the count
 * beside it was measured, not promised.
 */
export function relaxations(data: JobEntry[], s: FilterState): Relaxation[] {
  const candidates = activeFilters(s);
  // Dropping the last word is usually a better offer than dropping the query:
  // "senior rag pytorch" → "senior rag" keeps the intent.
  if (s.q.trim().split(/\s+/).filter(Boolean).length > 1) {
    candidates.unshift({ key: QUERY_TRIM, value: "" });
  }
  return candidates
    .map(({ key, value }) => {
      const state = without(s, key, value);
      return { key, value, state, count: filterJobs(data, state).length };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

const isWork = (v: string) => WORK_OPTIONS.some((w) => w.id === v);
const isLevel = (v: string) =>
  v === SENIOR_PLUS || (SENIORITIES as readonly string[]).includes(v);

/**
 * Filter state from a URL. Values that name nothing are dropped rather than
 * carried: `?work=wherever` would otherwise match no job at all and present as
 * an empty board rather than a bad link.
 *
 * Neither `?sort=pay` nor `?pay=1` is read. The first ordered the board by
 * salary and sank the 53% with no published range; the second replaced it with
 * an honest "shows pay" toggle, which has since gone too — pay is on the cards
 * and reported on /stats, and it was the least-used control in the bar. Old
 * links carrying either param degrade to an unfiltered board. `?since=` (the
 * posted-within pills) retired the same way: the board only carries 90 days of
 * roles and newest-first is the default order, so the control mostly restated
 * what the page already did.
 */
export function parseState(params: URLSearchParams): FilterState {
  const one = (k: string, ok?: (v: string) => boolean) => {
    const v = params.get(k) ?? "";
    return !v || !ok || ok(v) ? v : "";
  };
  return {
    q: params.get("q") ?? "",
    country: params.get("country") ?? "",
    city: params.get("city") ?? "",
    level: one("level", isLevel),
    work: one("work", isWork),
    skills: (params.get("skill") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

/** The query string for a state — the inverse of `parseState`. */
export function toParams(s: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.q.trim()) p.set("q", s.q.trim());
  if (s.level) p.set("level", s.level);
  if (s.country) p.set("country", s.country);
  if (s.city) p.set("city", s.city);
  if (s.work) p.set("work", s.work);
  if (s.skills.length) p.set("skill", s.skills.join(","));
  return p;
}
