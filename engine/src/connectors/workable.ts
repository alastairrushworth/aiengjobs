import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { USER_AGENT, stripHtml } from "../util/html.ts";
import { mapPool } from "../util/concurrency.ts";

// Workable's public board API lists jobs without descriptions, so each posting
// needs a follow-up detail fetch — bounded so big boards don't hammer the API.
const DETAIL_CONCURRENCY = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Workable rate-limits request bursts with HTTP 429; retry with backoff.
async function workableFetch(url: string, attempts = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status !== 429 || i >= attempts - 1) return res;
    await sleep(500 * 2 ** i); // 500ms, 1s, 2s
  }
}

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
    const res = await workableFetch(workable.endpoint(slug));
    if (!res.ok) throw new Error(`workable ${slug} HTTP ${res.status}`);
    const data = (await res.json()) as { jobs?: WorkableListJob[] };
    const jobs = (data.jobs ?? []).filter((j) => j.application_url ?? j.shortlink ?? j.url);

    return mapPool(jobs, DETAIL_CONCURRENCY, async (j): Promise<RawPosting> => {
      // Detail carries the description + structured location; degrade gracefully
      // (list-only posting) if a single job's detail fetch fails.
      let detail: WorkableDetail | undefined;
      try {
        const dr = await workableFetch(
          `https://apply.workable.com/api/v2/accounts/${slug}/jobs/${j.shortcode}`,
        );
        if (dr.ok) detail = (await dr.json()) as WorkableDetail;
      } catch {
        detail = undefined;
      }

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
