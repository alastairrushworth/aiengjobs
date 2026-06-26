import type { RawPosting } from "../connectors/types.ts";
import type { Company } from "@aiengjobs/shared";

export interface NormalizedJob {
  title: string;
  normalizedTitle: string;
  applyUrl: string;
  descriptionHtml?: string;
  descriptionText?: string;
  locationRaw?: string;
  /** company.slug | normalized_title | location — collapses the same role across sources (§6.5). */
  dedupKey: string;
}

export function normalize(raw: RawPosting, company: Company): NormalizedJob {
  const normalizedTitle = raw.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const descriptionText = raw.descriptionHtml
    ? stripHtml(raw.descriptionHtml)
    : undefined;
  const dedupKey = `${company.slug}|${normalizedTitle}|${(raw.locationRaw ?? "").toLowerCase()}`;

  return {
    title: raw.title,
    normalizedTitle,
    applyUrl: raw.applyUrl,
    descriptionHtml: raw.descriptionHtml,
    descriptionText,
    locationRaw: raw.locationRaw,
    dedupKey,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
