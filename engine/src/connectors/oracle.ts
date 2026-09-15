import type { Connector, RawPosting } from "./types.ts";
import { stripHtml } from "../util/html.ts";
import { guardedPool } from "../util/concurrency.ts";
import { fetchDetail, fetchRetry } from "../util/fetch.ts";
import { AI_QUERIES, TECH_TITLE, planDetailFetch } from "../util/enterprise.ts";

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
  // Via fetchRetry, not bare fetch: these enterprise tenants are the slowest
  // feeds on the board and the likeliest to tarpit a bot, and a hung socket
  // here would stall the whole nightly run against its 300-minute timeout.
  return fetchRetry(url, { headers: { Accept: "application/json" } });
}

export const oracle: Connector = {
  provider: "oracle",
  endpoint: (slug) => {
    const { base, site } = parseSlug(slug);
    return `${base}/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${site},limit=${LIMIT},sortBy=POSTING_DATES_DESC`;
  },
  async fetchPostings(slug, ctx) {
    const { host, site, base } = parseSlug(slug);

    // Union several keyword searches; the finder syntax keeps ';' and ',' literal
    // (valid query sub-delimiters), with only the keyword value percent-encoded.
    const byId = new Map<string, OracleReq>();
    // A keyword that fills its page has hits we never saw, so the listing is
    // reported as truncated (see PostingsResult.partial).
    let truncated = false;
    for (const q of AI_QUERIES) {
      const finder = `findReqs;siteNumber=${site},limit=${LIMIT},sortBy=POSTING_DATES_DESC,keyword=${encodeURIComponent(q)}`;
      const url = `${base}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`;
      const res = await ofetch(url);
      if (!res.ok) throw new Error(`oracle ${host} HTTP ${res.status}`);
      const data = (await res.json()) as {
        items?: { requisitionList?: OracleReq[] }[];
      };
      for (const item of data.items ?? []) {
        const list = item.requisitionList ?? [];
        if (list.length >= LIMIT) truncated = true;
        for (const r of list) {
          if (r.Id) byId.set(r.Id, r);
        }
      }
      await sleep(150);
    }

    const kept = [...byId.values()].filter(
      (r) => r.Title && TECH_TITLE.test(r.Title),
    );
    // Rows past the detail cap are reported as seen rather than dropped — see
    // PostingsResult.seen.
    const { targets, seen } = planDetailFetch(
      kept,
      (r) => ({ id: r.Id, title: (r.Title ?? "").trim() }),
      MAX_DETAIL,
      ctx,
    );
    if (seen.length > 0) {
      console.warn(
        `[oracle] ${host}: ${kept.length} matched, fetching detail for ${targets.length}, ${seen.length} marked seen`,
      );
    }
    if (truncated) {
      console.warn(`[oracle] ${host}: a keyword filled its ${LIMIT}-row page, listing is partial`);
    }

    const postings = await guardedPool(targets, DETAIL_CONCURRENCY, `oracle ${host}`, async (r, attempt): Promise<RawPosting> => {
      // Detail carries the HTML description; degrade to the list row on failure.
      const info = await attempt(async () => {
        const durl = `${base}/recruitingCEJobRequisitionDetails?onlyData=true&expand=all&finder=ById;Id=%22${encodeURIComponent(r.Id)}%22,siteNumber=${site}`;
        const dr = await fetchDetail(durl, { headers: { Accept: "application/json" } });
        return ((await dr.json()) as { items?: OracleDetail[] }).items?.[0];
      });
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
    return { postings, partial: truncated, seen };
  },
};
