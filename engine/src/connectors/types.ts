import type { AtsProvider, RemoteType } from "@aiengjobs/shared";

/** A raw posting pulled from an ATS feed, before normalization/classification. */
export interface RawPosting {
  externalId: string;
  title: string;
  descriptionHtml?: string;
  descriptionText?: string;
  applyUrl: string;
  locationRaw?: string;
  postedAt?: string; // ISO 8601
  updatedAt?: string; // ISO 8601
  remoteType?: RemoteType; // when the ATS declares it explicitly
  remoteHint?: boolean; // softer signal (e.g. Ashby isRemote)
  employmentType?: string;
  // Structured comp, when the ATS exposes it (Ashby). Currency/period parsed by the connector.
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
}

export interface Connector {
  provider: AtsProvider;
  /** Public, no-auth feed URL for a company's board, keyed by ATS slug. */
  endpoint(slug: string): string;
  /** Fetch + map the feed to RawPosting[]. Throws on fetch/parse error (so the
   *  caller does NOT treat the feed as empty and wrongly expire that company's jobs). */
  fetchPostings(slug: string): Promise<RawPosting[]>;
}
