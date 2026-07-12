import { CLUSTERS, CLUSTER_OF_SKILL } from "@aiengjobs/shared/taxonomy";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";

/** The full taxonomy skill list — also handed to the LLM extractor as its enum. */
export const ALL_SKILLS = CLUSTERS.flatMap((c) => c.skills);
const SKILL_SET = new Set(ALL_SKILLS.map((s) => s.toLowerCase()));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Variant spellings/synonyms that count as textual evidence for a skill whose
// canonical name rarely appears verbatim in postings (lower-case keys/values).
const SYNONYMS: Record<string, string[]> = {
  // Deliberately NOT bare "openai"/"anthropic"/"claude": company-name mentions
  // (employer boilerplate, "competitors like OpenAI") aren't skill evidence.
  "openai api": ["openai apis", "openai's api", "openai’s api"],
  "anthropic api": ["anthropic apis", "anthropic's api", "anthropic’s api", "claude api"],
  "hugging face": ["huggingface"],
  "tool use": ["tool calling", "tool-calling", "function calling", "function-calling"],
  "eval harnesses": ["evals", "eval harness", "evaluation harness"],
  "llm-as-judge": ["llm as a judge", "llm as judge", "llm judge"],
  "multi-agent": ["multi agent", "multiagent"],
  "embeddings": ["embedding"],
  "reranking": ["rerank", "reranker"],
  "rag": ["retrieval-augmented generation", "retrieval augmented generation"],
};

// Word-boundary matcher per skill so "rag" doesn't match inside "storage",
// nor "go" inside "category". Boundaries are non-alphanumeric on both sides.
const SKILL_MATCHERS: { name: string; re: RegExp }[] = ALL_SKILLS.map((name) => {
  const variants = [name.toLowerCase(), ...(SYNONYMS[name.toLowerCase()] ?? [])];
  return {
    name,
    re: new RegExp(
      `(?<![a-z0-9])(?:${variants.map(escapeRegex).join("|")})(?![a-z0-9])`,
    ),
  };
});

const MATCHER_OF_SKILL = new Map(SKILL_MATCHERS.map((m) => [m.name.toLowerCase(), m.re]));

export interface TagResult {
  skills: string[];
  clusters: ClusterId[];
}

/** Word-boundary taxonomy-term matches in the text — cheap first pass. */
export function tagHeuristic(text: string): TagResult {
  const hay = text.toLowerCase();
  const skills: string[] = [];
  for (const { name, re } of SKILL_MATCHERS) {
    if (re.test(hay)) skills.push(name);
  }
  return finalize(skills);
}

/**
 * Merge heuristic + LLM-extracted skills, drop non-taxonomy terms, roll up clusters.
 *
 * An LLM-proposed skill must clear the same textual-evidence bar as the
 * heuristic (canonical name or a SYNONYMS variant present in the text). The
 * extractor was observed enum-spraying — tagging jobs with dozens of skills the
 * posting never mentions — so no tag is ever emitted without evidence.
 */
export function combineSkills(text: string, llmSkills: string[] = []): TagResult {
  const base = tagHeuristic(text).skills;
  const hay = text.toLowerCase();
  const extra = llmSkills
    .map(canonical)
    .filter((s): s is string => s !== undefined)
    .filter((s) => MATCHER_OF_SKILL.get(s.toLowerCase())?.test(hay) ?? false);
  return finalize([...base, ...extra]);
}

function canonical(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (!SKILL_SET.has(lower)) return undefined;
  return ALL_SKILLS.find((s) => s.toLowerCase() === lower);
}

function finalize(skills: string[]): TagResult {
  const uniq = [...new Set(skills)];
  const clusters = [
    ...new Set(
      uniq
        .map((s) => CLUSTER_OF_SKILL[s.toLowerCase()])
        .filter((c): c is ClusterId => Boolean(c)),
    ),
  ];
  return { skills: uniq, clusters };
}
