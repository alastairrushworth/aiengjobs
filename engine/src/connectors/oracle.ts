import type { Connector, RawPosting } from "./types.ts";
import { USER_AGENT, stripHtml } from "../util/html.ts";
import { mapPool } from "../util/concurrency.ts";
import { AI_QUERIES, TECH_TITLE } from "../util/enterprise.ts";

// Oracle Recruiting Cloud (Fusion / "Oracle Cloud HCM") public candidate-
// experience REST API. A site is keyed by its Fusion host plus a numeric
// site identifier ("siteNumber", e.g. CX_1 / CX_2001), so the seed slug encodes
// them as "host:site" (e.g. "edel.fa.us2.oraclecloud.com:CX_2001"). Enterprise
// Oracle boards carry thousands of roles, so — like Workday — we query the
// AI/ML slice via the `keyword` finder and keep only engineering-flavoured
// titles; the classifier does the rest.
const LIMIT = 100; // requisitionList page size
const MAX_DETAIL = 50; // cap on per-job detail fetches per run
const DETAIL_CONCURRENCY = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OracleReq {
  Id: string;
  Title?: string;
  PostedDate?: string; // ISO date
  PrimaryLocation?: string;
  secondaryLocations?: { Name?: string }[];
}
interface OracleDetail {
  ExternalDescriptionStr?: string; // HTML
  ExternalResponsibilitiesStr?: string; // HTML
  ExternalQualificationsStr?: string; // HTML
  PostedDate?: string;
  PrimaryLocation?: string;
}

function parseSlug(slug: string): { host: string; site: string; base: string } {
  const [host, site] = slug.split(":");
  if (!host || !site) {
    throw new Error(`oracle slug must be "host:siteNumber", got "${slug}"`);
  }
  return { host, site, base: `https://${host}/hcmRestApi/resources/latest` };
}

async function ofetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
}

export const oracle: Connector = {
  provider: "oracle",
  endpoint: (slug) => {
    const { base, site } = parseSlug(slug);
    return `${base}/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${site},limit=${LIMIT},sortBy=POSTING_DATES_DESC`;
  },
  async fetchPostings(slug) {
    const { host, site, base } = parseSlug(slug);

    // Union several keyword searches; the finder syntax keeps ';' and ',' literal
    // (valid query sub-delimiters), with only the keyword value percent-encoded.
    const byId = new Map<string, OracleReq>();
    for (const q of AI_QUERIES) {
      const finder = `findReqs;siteNumber=${site},limit=${LIMIT},sortBy=POSTING_DATES_DESC,keyword=${encodeURIComponent(q)}`;
      const url = `${base}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`;
      const res = await ofetch(url);
      if (!res.ok) throw new Error(`oracle ${host} HTTP ${res.status}`);
      const data = (await res.json()) as {
        items?: { requisitionList?: OracleReq[] }[];
      };
      for (const item of data.items ?? []) {
        for (const r of item.requisitionList ?? []) {
          if (r.Id) byId.set(r.Id, r);
        }
      }
      await sleep(150);
    }

    const kept = [...byId.values()].filter(
      (r) => r.Title && TECH_TITLE.test(r.Title),
    );
    if (kept.length > MAX_DETAIL) {
      console.warn(
        `[oracle] ${host}: ${kept.length} matched, capping detail fetch at ${MAX_DETAIL}`,
      );
    }
    const targets = kept.slice(0, MAX_DETAIL);

    return mapPool(targets, DETAIL_CONCURRENCY, async (r): Promise<RawPosting> => {
      // Detail carries the HTML description; degrade to the list row on failure.
      let info: OracleDetail | undefined;
      try {
        const durl = `${base}/recruitingCEJobRequisitionDetails?onlyData=true&expand=all&finder=ById;Id=%22${encodeURIComponent(r.Id)}%22,siteNumber=${site}`;
        const dr = await ofetch(durl);
        if (dr.ok) {
          info = ((await dr.json()) as { items?: OracleDetail[] }).items?.[0];
        }
      } catch {
        info = undefined;
      }
      const html = [
        info?.ExternalDescriptionStr,
        info?.ExternalResponsibilitiesStr,
        info?.ExternalQualificationsStr,
      ]
        .filter(Boolean)
        .join("\n");
      const loc =
        r.PrimaryLocation ??
        info?.PrimaryLocation ??
        r.secondaryLocations?.map((s) => s.Name).filter(Boolean).join("; ");
      const posted = r.PostedDate ?? info?.PostedDate;
      return {
        externalId: r.Id,
        title: (r.Title ?? "").trim(),
        descriptionHtml: html || undefined,
        descriptionText: html ? stripHtml(html) : undefined,
        applyUrl: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}`,
        locationRaw: loc || undefined,
        postedAt:
          posted && !Number.isNaN(Date.parse(posted))
            ? new Date(posted).toISOString()
            : undefined,
      };
    });
  },
};
