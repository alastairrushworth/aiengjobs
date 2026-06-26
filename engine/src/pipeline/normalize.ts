import type { RawPosting } from "../connectors/types.ts";
import { stripHtml } from "../util/html.ts";

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

export function normalize(raw: RawPosting, companySlug: string): NormalizedJob {
  const normalizedTitle = raw.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const descriptionText =
    raw.descriptionText ??
    (raw.descriptionHtml ? stripHtml(raw.descriptionHtml) : undefined);
  const dedupKey = `${companySlug}|${normalizedTitle}|${(raw.locationRaw ?? "").toLowerCase()}`;

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
