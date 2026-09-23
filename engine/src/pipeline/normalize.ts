import type { RawPosting } from "../connectors/types.ts";
import { decodeEntities, stripHtml } from "../util/html.ts";

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
  // ATS feeds deliver titles/locations with HTML entities ("&amp;", "&#8211;");
  // decode once here so every downstream consumer (site cards, JSON-LD, meta
  // tags) gets clean text. stripHtml already decodes descriptions.
  //
  // Titles and locations are single-line fields, and decoding is what can make
  // them multi-line: an encoded "&#10;" becomes a real newline, which lets a
  // feed's title leave its heading in the MCP output and start a paragraph that
  // reads as the board's own text. Collapse whitespace after decoding. Slugs and
  // the content hash are unaffected — slugify already folds separator runs, and
  // the hash reads the raw title.
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  const title = oneLine(decodeEntities(raw.title));
  const locationRaw = raw.locationRaw ? oneLine(decodeEntities(raw.locationRaw)) : undefined;
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const descriptionText =
    raw.descriptionText ??
    (raw.descriptionHtml ? stripHtml(raw.descriptionHtml) : undefined);
  const dedupKey = `${companySlug}|${normalizedTitle}|${(locationRaw ?? "").toLowerCase()}`;

  return {
    title,
    normalizedTitle,
    applyUrl: raw.applyUrl,
    descriptionHtml: raw.descriptionHtml,
    descriptionText,
    locationRaw,
    dedupKey,
  };
}
