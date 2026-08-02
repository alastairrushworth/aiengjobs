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

/** A connector's answer when it cannot promise it saw the whole board.
 *
 *  The enterprise connectors (workday, oracle, icims) cap how many postings
 *  they will fetch detail for. `closeStaleJobs` closes every open role at a
 *  polled source that was not in the returned set, so a capped return used to
 *  close the roles ranked past the cap — which then reappeared whenever result
 *  ordering shifted them back in. Boards flapped open and closed nightly.
 *
 *  Saying `partial: true` keeps the source out of `polledSourceIds`, the same
 *  protection an empty feed already gets. */
export interface PostingsResult {
  postings: RawPosting[];
  /** True when this is a capped subset of the board, not the whole of it. */
  partial?: boolean;
}

export interface Connector {
  provider: AtsProvider;
  /** Public, no-auth feed URL for a company's board, keyed by ATS slug. */
  endpoint(slug: string): string;
  /** Fetch + map the feed to RawPosting[]. Throws on fetch/parse error (so the
   *  caller does NOT treat the feed as empty and wrongly expire that company's jobs).
   *  Return a {@link PostingsResult} instead of a bare array to declare that the
   *  result is capped. */
  fetchPostings(slug: string): Promise<RawPosting[] | PostingsResult>;
}
