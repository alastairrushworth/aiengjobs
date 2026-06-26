import type { AtsProvider } from "@aiengjobs/shared";

/** A raw posting as pulled from an ATS feed, before normalization/classification. */
export interface RawPosting {
  externalId: string;
  title: string;
  descriptionHtml?: string;
  applyUrl: string;
  locationRaw?: string;
  updatedAt?: string;
  /** Provider-specific blob (e.g. Ashby compensation JSON-LD) parsed downstream. */
  raw?: unknown;
}

export interface Connector {
  provider: AtsProvider;
  /** Public, no-auth feed URL for a company's board, keyed by ATS slug. */
  endpoint(slug: string): string;
  /** Fetch + map the feed to RawPosting[]. Implemented in Phase 1. */
  fetchPostings(slug: string): Promise<RawPosting[]>;
}
