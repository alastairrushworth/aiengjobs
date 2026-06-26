import { CLUSTERS, CLUSTER_OF_SKILL } from "@aiengjobs/shared/taxonomy";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";
import { llmJSON, llmEnabled } from "./llm.ts";

const ALL_SKILLS = CLUSTERS.flatMap((c) => c.skills);
const SKILL_SET = new Set(ALL_SKILLS.map((s) => s.toLowerCase()));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary matcher per skill so "rag" doesn't match inside "storage",
// nor "go" inside "category". Boundaries are non-alphanumeric on both sides.
const SKILL_MATCHERS: { name: string; re: RegExp }[] = ALL_SKILLS.map((name) => ({
  name,
  re: new RegExp(`(?<![a-z0-9])${escapeRegex(name.toLowerCase())}(?![a-z0-9])`),
}));

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

/** Heuristic skills, augmented by a GPT-5.4-nano pass constrained to the taxonomy. */
export async function tagJob(text: string): Promise<TagResult> {
  const base = tagHeuristic(text);
  if (!llmEnabled()) return base;

  const out = await llmJSON(
    `Extract the AI-engineering skills/technologies present in this job text. Choose ONLY from this exact list (use the exact spelling): ${ALL_SKILLS.join(", ")}. Respond with JSON: {"skills": string[]}.`,
    text.slice(0, 3500),
  );
  if (out && Array.isArray(out.skills)) {
    const llmSkills = (out.skills as unknown[])
      .filter((s): s is string => typeof s === "string")
      .map(canonical)
      .filter((s): s is string => s !== undefined);
    return finalize([...base.skills, ...llmSkills]);
  }
  return base;
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
