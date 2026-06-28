import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { USER_AGENT, stripHtml } from "../util/html.ts";
import { mapPool } from "../util/concurrency.ts";

// SmartRecruiters' public Posting API paginates (max 100/page) and omits the job
// ad body from the list, so each posting needs a detail fetch — bounded so big
// boards (Wise has 350+) don't hammer the API. Note: the API returns 200 with
// totalFound:0 for an unknown company identifier (never 404), so an empty board
// and a wrong slug look the same — both correctly yield [].
const PAGE = 100;
const MAX_JOBS = 3000; // pagination safety cap
const DETAIL_CONCURRENCY = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function srFetch(url: string, attempts = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status !== 429 || i >= attempts - 1) return res;
    await sleep(500 * 2 ** i); // 500ms, 1s, 2s
  }
}

interface SrLocation {
  city?: string;
  region?: string;
  country?: string; // lowercase ISO-3166 alpha-2
  remote?: boolean;
  hybrid?: boolean;
  fullLocation?: string;
}
interface SrListItem {
  id: string;
  name: string;
  refNumber?: string;
  releasedDate?: string;
  location?: SrLocation;
  typeOfEmployment?: { label?: string };
  ref?: string; // detail API URL
}
interface SrDetail {
  postingUrl?: string;
  applyUrl?: string;
  location?: SrLocation;
  typeOfEmployment?: { label?: string };
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
}

function srRemote(loc?: SrLocation): { remoteType?: RemoteType; hint?: boolean } {
  if (!loc) return {};
  if (loc.remote) return { remoteType: "remote", hint: true };
  if (loc.hybrid) return { remoteType: "hybrid", hint: false };
  if (loc.city || loc.country) return { remoteType: "onsite", hint: false };
  return {};
}

function srLocationRaw(loc?: SrLocation): string | undefined {
  if (!loc) return undefined;
  // fullLocation reads "City, , Country" (empty region) — drop the empty parts.
  const clean = (loc.fullLocation ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
  if (clean) return clean;
  const parts = [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

export const smartrecruiters: Connector = {
  provider: "smartrecruiters",
  endpoint: (slug) =>
    `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${PAGE}`,
  async fetchPostings(slug) {
    const list: SrListItem[] = [];
    for (let offset = 0; offset < MAX_JOBS; offset += PAGE) {
      const res = await srFetch(
        `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${PAGE}&offset=${offset}`,
      );
      if (!res.ok) throw new Error(`smartrecruiters ${slug} HTTP ${res.status}`);
      const data = (await res.json()) as { content?: SrListItem[]; totalFound?: number };
      const batch = data.content ?? [];
      list.push(...batch);
      if (batch.length < PAGE || list.length >= (data.totalFound ?? list.length)) break;
    }

    return mapPool(list, DETAIL_CONCURRENCY, async (j): Promise<RawPosting> => {
      // Detail carries the job ad + apply URL; degrade to list-only on failure.
      let detail: SrDetail | undefined;
      try {
        const dr = await srFetch(
          j.ref ?? `https://api.smartrecruiters.com/v1/companies/${slug}/postings/${j.id}`,
        );
        if (dr.ok) detail = (await dr.json()) as SrDetail;
      } catch {
        detail = undefined;
      }

      const sections = detail?.jobAd?.sections ?? {};
      const html = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
        .map((k) => sections[k]?.text)
        .filter(Boolean)
        .join("\n");
      const loc = detail?.location ?? j.location;
      const { remoteType, hint } = srRemote(loc);

      return {
        externalId: j.id,
        title: j.name.trim(),
        descriptionHtml: html || undefined,
        descriptionText: html ? stripHtml(html) : undefined,
        applyUrl:
          detail?.postingUrl ??
          detail?.applyUrl ??
          `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
        locationRaw: srLocationRaw(loc),
        remoteType,
        remoteHint: hint,
        employmentType: (detail?.typeOfEmployment ?? j.typeOfEmployment)?.label,
        postedAt: j.releasedDate,
      };
    });
  },
};
