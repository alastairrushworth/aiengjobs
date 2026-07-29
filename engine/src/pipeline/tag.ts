import { CLUSTERS, CLUSTER_OF_SKILL } from "@aiengjobs/shared/taxonomy";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";

/** The full taxonomy skill list. */
export const ALL_SKILLS = CLUSTERS.flatMap((c) => c.skills);

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

export interface TagResult {
  skills: string[];
  clusters: ClusterId[];
}

/**
 * Word-boundary taxonomy-term matches in the text — the only source of tags.
 *
 * The LLM extractor used to propose skills too, but every proposal had to clear
 * these same matchers as an anti-enum-spraying guard, which made its output a
 * strict subset of this function's. It no longer asks for them.
 */
export function tagHeuristic(text: string): TagResult {
  const hay = text.toLowerCase();
  const skills: string[] = [];
  for (const { name, re } of SKILL_MATCHERS) {
    if (re.test(hay)) skills.push(name);
  }
  return finalize(skills);
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
