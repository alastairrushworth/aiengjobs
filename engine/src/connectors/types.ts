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
  /** True when the *listing* was truncated — the connector could not enumerate
   *  the whole board, so absence from `postings` + `seen` proves nothing. A
   *  capped detail fetch on its own is not partial: the roles past the cap go
   *  in `seen` instead. */
  partial?: boolean;
  /** External ids the connector saw listed but did not return as postings —
   *  the roles past a detail-fetch cap. The ingest loop stamps the stored ones
   *  as seen tonight, so they neither close as stale nor need re-fetching, and
   *  a complete listing can once again close what has really gone.
   *
   *  Before this, a capped board was simply `partial`, and its roles past the
   *  cap were never seen again: ~300 Workday roles sat open for six weeks
   *  after their employers had closed them (2026-09-14). */
  seen?: string[];
}

/** What the ingest loop can tell a connector about the board it already holds. */
export interface FetchContext {
  /** Is this listed posting already stored, open, and still carrying this
   *  title? A capped connector spends its detail budget on the ones that are
   *  not, so a new role reaches the board the night it appears rather than
   *  when it happens to rank — and a req id that Workday has reused for a
   *  different role, or a role that closed and came back, is re-read rather
   *  than stamped seen under its old advert. */
  isKnown?(externalId: string, title?: string): boolean;
}

export interface Connector {
  provider: AtsProvider;
  /** Public, no-auth feed URL for a company's board, keyed by ATS slug. */
  endpoint(slug: string): string;
  /** Fetch + map the feed to RawPosting[]. Throws on fetch/parse error (so the
   *  caller does NOT treat the feed as empty and wrongly expire that company's jobs).
   *  Return a {@link PostingsResult} instead of a bare array to declare that the
   *  listing is truncated or that some listed roles were not fetched. */
  fetchPostings(slug: string, ctx?: FetchContext): Promise<RawPosting[] | PostingsResult>;
}
