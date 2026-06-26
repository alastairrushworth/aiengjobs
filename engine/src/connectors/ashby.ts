import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { USER_AGENT, stripHtml } from "../util/html.ts";
import { parseSalaryText } from "../pipeline/comp.ts";

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  workplaceType?: string; // Remote | Hybrid | OnSite
  employmentType?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  updatedAt?: string | null;
  isListed?: boolean;
  compensation?: {
    scrapeableCompensationSalarySummary?: string;
    compensationTierSummary?: string;
  };
}

function ashbyRemote(wt?: string, isRemote?: boolean): RemoteType | undefined {
  switch ((wt ?? "").toLowerCase()) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "onsite":
    case "on-site":
      return "onsite";
    default:
      return isRemote ? "remote" : undefined;
  }
}

// Ashby public job-board API (spec §6.1) — cleanest compensation data.
export const ashby: Connector = {
  provider: "ashby",
  endpoint: (slug) =>
    `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
  async fetchPostings(slug) {
    const res = await fetch(ashby.endpoint(slug), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`ashby ${slug} HTTP ${res.status}`);
    const data = (await res.json()) as { jobs?: AshbyJob[] };

    return (data.jobs ?? [])
      .filter((j) => j.isListed !== false)
      .map((j): RawPosting => {
        const sal = parseSalaryText(
          j.compensation?.scrapeableCompensationSalarySummary ??
            j.compensation?.compensationTierSummary,
        );
        return {
          externalId: j.id,
          title: j.title.trim(),
          descriptionHtml: j.descriptionHtml,
          descriptionText:
            j.descriptionPlain ??
            (j.descriptionHtml ? stripHtml(j.descriptionHtml) : undefined),
          applyUrl: j.applyUrl ?? j.jobUrl ?? "",
          locationRaw: j.location,
          remoteType: ashbyRemote(j.workplaceType, j.isRemote),
          remoteHint: j.isRemote,
          employmentType: j.employmentType,
          postedAt: j.publishedAt,
          updatedAt: j.updatedAt ?? undefined,
          salaryMin: sal?.salaryMin,
          salaryMax: sal?.salaryMax,
          salaryCurrency: sal?.salaryCurrency,
          salaryPeriod: sal?.salaryPeriod,
        };
      })
      .filter((p) => p.applyUrl.length > 0);
  },
};
