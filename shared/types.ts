// Core data model (spec §7). Shared by the ingestion engine and the Astro site.
import type { ClusterId } from "./taxonomy.ts";

export type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "recruitee"
  | "teamtailor"
  | "smartrecruiters"
  | "workday"
  | "personio"
  | "direct";

export type RemoteType = "remote" | "hybrid" | "onsite";

/** Canonical seniority ladder, in display order. Single source of truth for the
 *  type, filter options, and stats ordering. */
export const SENIORITIES = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
] as const;

export type Seniority = (typeof SENIORITIES)[number];

export type Classification = "in" | "out";

export type SalaryPeriod = "year" | "month" | "day" | "hour";

export interface Company {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  /** Internal provenance — the engine sets these, but the exporter omits them
   *  from the public snapshot. */
  atsProvider?: AtsProvider;
  atsToken?: string;
  stage?: string;
  size?: string;
  logoUrl?: string;
  description?: string;
}

export interface Job {
  /** Internal ids — present in the engine, omitted from the public snapshot. */
  id?: string;
  companyId?: string;
  slug: string;
  companyName: string;
  companySlug: string;

  title: string;
  normalizedTitle: string;
  descriptionHtml?: string;
  descriptionText?: string;
  applyUrl: string;

  locationRaw?: string;
  country?: string;
  region?: string;
  city?: string;
  remoteType?: RemoteType;

  seniority?: Seniority;

  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: SalaryPeriod;

  /** Engine-internal classification — omitted from the public snapshot (the
   *  exporter only writes classification='in' jobs). */
  classification?: Classification;
  classificationConfidence?: number;

  /** Canonical skill names (from the taxonomy) extracted from title + description. */
  skills: string[];
  /** Distinct clusters the skills roll up to — the browse facets. */
  clusters: ClusterId[];

  isFeatured?: boolean;
  isDirect?: boolean;
  /** True when the role vanished from its feed — exported (recently-closed only)
   *  so the site can render a tombstone page instead of a 404. */
  isClosed?: boolean;

  postedAt?: string;
  updatedAt?: string;
  ingestedAt: string;
  expiresAt?: string;

  contentHash?: string;
}

/** The snapshot the engine writes to site/src/data and the site reads at build time. */
export interface SiteSnapshot {
  generatedAt: string;
  /**
   * Currency code → multiplier to USD at generation time (USD: 1, e.g. GBP ≈ 1.27).
   * Pulled live during the nightly refresh so local-currency pay can be converted
   * to USD for like-for-like comparison on the stats page.
   */
  fxRates: Record<string, number>;
  jobs: Job[];
  companies: Company[];
}
