import type { RemoteType, SalaryPeriod, Seniority } from "@aiengjobs/shared";
import { llmStructured } from "./llm.ts";
import { ALL_SKILLS } from "./tag.ts";

/** Everything the LLM pulls out of a posting in a single structured call. */
export interface ExtractResult {
  /** In scope for the AI-engineering board? Mirrors the heuristic classifier. */
  inScope: boolean;
  confidence: number;
  skills: string[];
  seniority: Seniority | null;
  /** ISO 3166-1 alpha-2, e.g. "US", "GB". */
  country: string | null;
  city: string | null;
  remoteType: RemoteType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** ISO 4217, e.g. "USD", "GBP", "EUR". */
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
}

const SENIORITY: Seniority[] = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
];

// Strict JSON Schema (OpenAI Structured Outputs): every key is required and
// nullable fields carry an explicit "null" type so the model can omit a value.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "inScope",
    "confidence",
    "skills",
    "seniority",
    "country",
    "city",
    "remoteType",
    "salaryMin",
    "salaryMax",
    "salaryCurrency",
    "salaryPeriod",
  ],
  properties: {
    inScope: {
      type: "boolean",
      description: "True if the role is primarily AI-engineering (LLM apps, RAG, agents, evals, inference/serving, fine-tuning).",
    },
    confidence: { type: "number", description: "0..1 confidence in inScope." },
    skills: {
      type: "array",
      description: "AI-engineering skills/technologies explicitly present, from the allowed list only.",
      items: { type: "string", enum: ALL_SKILLS },
    },
    seniority: {
      type: ["string", "null"],
      enum: [...SENIORITY, null],
      description: "Seniority level, or null if not stated/inferable.",
    },
    country: {
      type: ["string", "null"],
      description: "Primary work-location country as an ISO 3166-1 alpha-2 code (e.g. US, GB, DE), or null.",
    },
    city: { type: ["string", "null"], description: "Primary work city, or null." },
    remoteType: {
      type: ["string", "null"],
      enum: ["remote", "hybrid", "onsite", null],
      description: "Work arrangement, or null if unclear.",
    },
    salaryMin: {
      type: ["number", "null"],
      description: "Lower bound of the stated salary range. Null unless a figure is explicitly given — never estimate.",
    },
    salaryMax: {
      type: ["number", "null"],
      description: "Upper bound of the stated salary range, or null. Never estimate.",
    },
    salaryCurrency: {
      type: ["string", "null"],
      description: "Salary currency as an ISO 4217 code (USD, GBP, EUR, …), or null.",
    },
    salaryPeriod: {
      type: ["string", "null"],
      enum: ["year", "month", "day", "hour", null],
      description: "Pay period for the salary figures, or null.",
    },
  },
} as const;

const SYSTEM =
  "You extract structured data from a single job posting for a STRICT AI-engineering job board. " +
  "IN scope: roles building LLM applications, RAG/retrieval, AI agents, evals/quality, inference/serving, or fine-tuning. " +
  "OUT of scope: data analyst/BI, pure data/research scientist, sales/marketing/PM, generic software roles with only a token \"AI a plus\", and non-engineering AI-tool-user roles. " +
  "Extract salary ONLY when the posting explicitly states figures — never invent or estimate a range. " +
  "Country must be an ISO 3166-1 alpha-2 code: infer it from ANY city, state, or region mentioned " +
  "(e.g. 'Redwood City' or 'Palo Alto, CA' → US; 'London' → GB; 'Bengaluru' → IN; 'Berlin' → DE), " +
  "not only from an explicit country name; use null only when no location signal exists at all. " +
  "Use null for any other field that is absent or not clearly inferable.";

const MAX_CHARS = 6000; // enough to reach most comp/location sections; cheap on nano

/**
 * Single GPT-5.4-nano structured-output call: classification + skills + salary +
 * location + seniority. Returns null when the LLM is disabled or the call fails,
 * so the caller falls back to heuristics. Strict schema guarantees the shape.
 */
export async function extractListing(
  title: string,
  descriptionText: string,
  locationRaw?: string,
): Promise<ExtractResult | null> {
  const locLine = locationRaw ? `Location: ${locationRaw}\n` : "";
  const out = await llmStructured(
    SYSTEM,
    `Title: ${title}\n${locLine}\nDescription:\n${descriptionText.slice(0, MAX_CHARS)}`,
    "job_extract",
    SCHEMA as unknown as Record<string, unknown>,
  );
  if (!out || typeof out.inScope !== "boolean") return null;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  return {
    inScope: out.inScope,
    confidence: typeof out.confidence === "number" ? out.confidence : 0.6,
    skills: Array.isArray(out.skills)
      ? (out.skills as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
    seniority: (str(out.seniority) as Seniority | null) ?? null,
    country: str(out.country)?.toUpperCase() ?? null,
    city: str(out.city),
    remoteType: (str(out.remoteType) as RemoteType | null) ?? null,
    salaryMin: num(out.salaryMin),
    salaryMax: num(out.salaryMax),
    salaryCurrency: str(out.salaryCurrency)?.toUpperCase() ?? null,
    salaryPeriod: (str(out.salaryPeriod) as SalaryPeriod | null) ?? null,
  };
}
