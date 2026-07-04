import { stripHtml } from "./html.ts";

// Shared helpers for the big-enterprise connectors (Workday-style: Oracle,
// Eightfold, iCIMS, SuccessFactors). Enterprise boards run to thousands of
// mostly non-engineering roles, so — like Workday — we query the AI/ML slice
// server-side (where the API supports a keyword) and keep only
// engineering-flavoured titles. The strict classifier downstream does the rest.

/** Union of single-term searches; searchText semantics vary by vendor, so we
 *  UNION several narrow queries rather than rely on one multi-word query. */
export const AI_QUERIES = ["machine learning", "generative ai", "llm"];

/** Engineering-flavoured title gate (same intent as the Workday connector). */
export const TECH_TITLE =
  /\b(engineer|engineering|developer|software|swe|machine learning|\bml\b|\bai\b|data|scien|research|quant|analytics|platform|infrastructure|architect|llm|nlp|intelligence|model|mlops|devops|sre)\b/i;

export interface JsonLdJob {
  title?: string;
  descriptionHtml?: string;
  datePosted?: string; // ISO
  location?: string;
  url?: string;
  identifier?: string;
}

/** Pull schema.org JobPosting objects out of a page's <script type="ld+json">
 *  blocks. iCIMS and SuccessFactors detail pages embed these, which is a far
 *  more stable parse than scraping their per-vendor markup. */
export function parseJsonLdJobs(html: string): JsonLdJob[] {
  const out: JsonLdJob[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // malformed block — skip, don't fail the page
    }
    // A block can be a single object, an array, or a @graph container.
    const nodes: unknown[] = Array.isArray(parsed)
      ? parsed
      : isGraph(parsed)
        ? parsed["@graph"]
        : [parsed];
    for (const node of nodes) {
      if (!isJobPosting(node)) continue;
      out.push({
        title: typeof node.title === "string" ? node.title.trim() : undefined,
        descriptionHtml:
          typeof node.description === "string" ? node.description : undefined,
        datePosted: toIso(node.datePosted),
        location: jsonLdLocation(node.jobLocation),
        url: typeof node.url === "string" ? node.url : undefined,
        identifier: jsonLdIdentifier(node.identifier),
      });
    }
  }
  return out;
}

function isGraph(v: unknown): v is { "@graph": unknown[] } {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as { "@graph"?: unknown })["@graph"])
  );
}

interface JobPostingNode {
  "@type"?: unknown;
  title?: unknown;
  description?: unknown;
  datePosted?: unknown;
  jobLocation?: unknown;
  url?: unknown;
  identifier?: unknown;
}

function isJobPosting(v: unknown): v is JobPostingNode {
  if (typeof v !== "object" || v === null) return false;
  const t = (v as JobPostingNode)["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && x.includes("JobPosting"));
}

function toIso(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** jobLocation is usually { address: { addressLocality, addressRegion,
 *  addressCountry } } but may be an array; flatten to a readable string. */
function jsonLdLocation(v: unknown): string | undefined {
  const first = Array.isArray(v) ? v[0] : v;
  if (typeof first !== "object" || first === null) return undefined;
  const addr = (first as { address?: unknown }).address;
  const a = Array.isArray(addr) ? addr[0] : addr;
  if (typeof a !== "object" || a === null) {
    return typeof addr === "string" ? addr : undefined;
  }
  const parts = ["addressLocality", "addressRegion", "addressCountry"]
    .map((k) => (a as Record<string, unknown>)[k])
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  return parts.length ? [...new Set(parts)].join(", ") : undefined;
}

function jsonLdIdentifier(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const val = (v as { value?: unknown }).value;
    if (typeof val === "string" || typeof val === "number") return String(val);
  }
  return undefined;
}

/** Best-effort description text from JobPosting HTML. */
export function jsonLdText(html?: string): string | undefined {
  return html ? stripHtml(html) : undefined;
}
