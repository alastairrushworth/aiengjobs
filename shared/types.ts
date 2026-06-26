// Core data model (spec §7). Shared by the ingestion engine and the Astro site.
import type { ClusterId } from "./taxonomy.ts";

export type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "recruitee"
  | "personio"
  | "direct";

export type RemoteType = "remote" | "hybrid" | "onsite";

export type Seniority =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "lead"
  | "manager";

export type Classification = "in" | "out";

export type SalaryPeriod = "year" | "month" | "day" | "hour";

export interface Company {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  atsProvider: AtsProvider;
  atsToken?: string;
  stage?: string;
  size?: string;
  logoUrl?: string;
  description?: string;
}

export interface Job {
  id: string;
  slug: string;
  companyId: string;
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

  classification: Classification;
  classificationConfidence?: number;

  /** Canonical skill names (from the taxonomy) extracted from title + description. */
  skills: string[];
  /** Distinct clusters the skills roll up to — the browse facets. */
  clusters: ClusterId[];

  isFeatured: boolean;
  isDirect: boolean;
  isNew: boolean;
  isClosed: boolean;

  postedAt?: string;
  updatedAt?: string;
  ingestedAt: string;
  expiresAt?: string;

  contentHash?: string;
}

/** The snapshot the engine writes to site/src/data and the site reads at build time. */
export interface SiteSnapshot {
  generatedAt: string;
  jobs: Job[];
  companies: Company[];
  facets: {
    clusters: { id: ClusterId; label: string; count: number }[];
    seniority: { id: Seniority; count: number }[];
    remoteType: { id: RemoteType; count: number }[];
  };
}
