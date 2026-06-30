import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { USER_AGENT, stripHtml } from "../util/html.ts";
import { AI_QUERIES, TECH_TITLE } from "../util/enterprise.ts";

// Eightfold AI talent-platform public careers API. A tenant is reached at a
// host (e.g. "hsbc.eightfold.ai") and keyed by the company "domain" it was
// onboarded with (e.g. "hsbc.com"); some customers serve it from a custom
// careers domain (e.g. "careers.moodys.com"). The seed slug encodes both as
// "host:domain". Like Workday, these are enterprise boards with thousands of
// roles, so we union a few AI/ML keyword searches server-side and keep only
// engineering-flavoured titles; the classifier does the rest.
const PAGE = 50;
const PER_QUERY_MAX = 150; // ~3 pages per query
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface EfPosition {
  id: number | string;
  name?: string;
  location?: string;
  locations?: string[];
  t_create?: number; // epoch seconds
  t_update?: number; // epoch seconds
  canonicalPositionUrl?: string;
  job_description?: string; // HTML, when present in the list payload
  work_location_option?: string; // onsite | remote | hybrid
}

function parseSlug(slug: string): { host: string; domain: string } {
  const [host, domain] = slug.split(":");
  if (!host || !domain) {
    throw new Error(`eightfold slug must be "host:domain", got "${slug}"`);
  }
  return { host, domain };
}

function efRemote(opt?: string): RemoteType | undefined {
  switch ((opt ?? "").toLowerCase()) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "onsite":
    case "on-site":
      return "onsite";
    default:
      return undefined;
  }
}

function efEpoch(s?: number): string | undefined {
  return s && s > 0 ? new Date(s * 1000).toISOString() : undefined;
}

export const eightfold: Connector = {
  provider: "eightfold",
  endpoint: (slug) => {
    const { host, domain } = parseSlug(slug);
    return `https://${host}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&start=0&num=${PAGE}`;
  },
  async fetchPostings(slug) {
    const { host, domain } = parseSlug(slug);
    const base = `https://${host}/api/apply/v2/jobs`;

    const byId = new Map<string, EfPosition>();
    for (const q of AI_QUERIES) {
      for (let start = 0; start < PER_QUERY_MAX; start += PAGE) {
        const url =
          `${base}?domain=${encodeURIComponent(domain)}` +
          `&query=${encodeURIComponent(q)}&start=${start}&num=${PAGE}&sort_by=relevance`;
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`eightfold ${host} HTTP ${res.status}`);
        const data = (await res.json()) as { positions?: EfPosition[] };
        const batch = data.positions ?? [];
        for (const p of batch) if (p.id != null) byId.set(String(p.id), p);
        if (batch.length < PAGE) break;
        await sleep(150);
      }
    }

    return [...byId.values()]
      .filter((p) => p.name && TECH_TITLE.test(p.name))
      .map((p): RawPosting => {
        const html = p.job_description;
        return {
          externalId: String(p.id),
          title: (p.name ?? "").trim(),
          descriptionHtml: html || undefined,
          descriptionText: html ? stripHtml(html) : undefined,
          applyUrl:
            p.canonicalPositionUrl ??
            `https://${host}/careers/job/${p.id}`,
          locationRaw: p.location ?? p.locations?.join("; "),
          postedAt: efEpoch(p.t_create),
          updatedAt: efEpoch(p.t_update),
          remoteType: efRemote(p.work_location_option),
        };
      });
  },
};
