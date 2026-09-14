import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { stripHtml } from "../util/html.ts";
import { fetchDetail, fetchRetry } from "../util/fetch.ts";
import { guardedPool } from "../util/concurrency.ts";

// Workable's public board API lists jobs without descriptions, so each posting
// needs a follow-up detail fetch — bounded so big boards don't hammer the API.
const DETAIL_CONCURRENCY = 4;

interface WorkableListJob {
  shortcode: string;
  title: string;
  employment_type?: string;
  telecommuting?: boolean;
  application_url?: string;
  shortlink?: string;
  url?: string;
  published_on?: string; // ISO date
  country?: string;
  city?: string;
  state?: string;
}

interface WorkableDetail {
  description?: string; // HTML
  requirements?: string; // HTML
  benefits?: string; // HTML
  workplace?: string; // remote | hybrid | on_site
  remote?: boolean;
  location?: { country?: string; city?: string; region?: string };
}

function workableRemote(workplace?: string, remote?: boolean): RemoteType | undefined {
  switch ((workplace ?? "").toLowerCase()) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "on_site":
    case "on-site":
    case "onsite":
      return "onsite";
    default:
      return remote ? "remote" : undefined;
  }
}

function listLocation(j: WorkableListJob): string | undefined {
  const parts = [j.city, j.state, j.country].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

// Workable public board API (no auth). List + per-job detail (spec §6.1).
export const workable: Connector = {
  provider: "workable",
  endpoint: (slug) => `https://www.workable.com/api/accounts/${slug}`,
  async fetchPostings(slug) {
    const res = await fetchRetry(workable.endpoint(slug));
    if (!res.ok) throw new Error(`workable ${slug} HTTP ${res.status}`);
    const data = (await res.json()) as { jobs?: WorkableListJob[] };
    // One row per location for a multi-location job, all sharing a shortcode:
    // Intertek's 250 rows were 149 jobs. The detail (and its single location)
    // is the same for each, so keep the first row and fetch it once.
    const byCode = new Map<string, WorkableListJob>();
    for (const j of data.jobs ?? []) {
      if ((j.application_url ?? j.shortlink ?? j.url) && !byCode.has(j.shortcode)) {
        byCode.set(j.shortcode, j);
      }
    }
    const jobs = [...byCode.values()];

    return guardedPool(jobs, DETAIL_CONCURRENCY, `workable ${slug}`, async (j, attempt): Promise<RawPosting> => {
      // Detail carries the description + structured location; degrade gracefully
      // (list-only posting) if a single job's detail fetch fails.
      const detail = await attempt(async () => {
        const dr = await fetchDetail(
          `https://apply.workable.com/api/v2/accounts/${slug}/jobs/${j.shortcode}`,
        );
        return (await dr.json()) as WorkableDetail;
      });

      const html = [detail?.description, detail?.requirements, detail?.benefits]
        .filter(Boolean)
        .join("\n");
      const loc = detail?.location;
      const locationRaw = loc
        ? [loc.city, loc.region, loc.country].filter(Boolean).join(", ")
        : listLocation(j);

      return {
        externalId: j.shortcode,
        title: j.title.trim(),
        descriptionHtml: html || undefined,
        descriptionText: html ? stripHtml(html) : undefined,
        applyUrl: j.application_url ?? j.shortlink ?? j.url ?? "",
        locationRaw: locationRaw || undefined,
        remoteType: workableRemote(detail?.workplace, detail?.remote ?? j.telecommuting),
        remoteHint: detail?.remote ?? j.telecommuting,
        employmentType: j.employment_type,
        postedAt: j.published_on,
      };
    });
  },
};
