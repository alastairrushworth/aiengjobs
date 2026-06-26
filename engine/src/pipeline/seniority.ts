import type { Seniority } from "@aiengjobs/shared";

/** Infer seniority from the title (spec §6.4). Returns undefined when unclear. */
export function inferSeniority(title: string): Seniority | undefined {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "intern";
  if (/\bprincipal\b/.test(t)) return "principal";
  if (/\bstaff\b/.test(t)) return "staff";
  if (/\b(head of|director|vp|vice president|manager)\b/.test(t)) return "manager";
  if (/\blead\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|associate|new ?grad|entry[- ]level|graduate)\b/.test(t))
    return "junior";
  return undefined;
}
