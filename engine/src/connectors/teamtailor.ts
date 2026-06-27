import type { Connector, RawPosting } from "./types.ts";
import { USER_AGENT, stripHtml } from "../util/html.ts";

interface TtAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
}
interface TtJobPosting {
  jobLocation?: { address?: TtAddress }[];
}
interface TtItem {
  id: string;
  title: string;
  url: string;
  date_published?: string; // ISO 8601 with offset
  content_html?: string;
  _jobposting?: TtJobPosting;
}

// Build "City, Region, Country" from the first schema.org jobLocation address.
function ttLocation(jp?: TtJobPosting): string | undefined {
  const a = jp?.jobLocation?.[0]?.address;
  if (!a) return undefined;
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

// Teamtailor JSON Feed (no auth) — board lives at {slug}.teamtailor.com/jobs.json.
// Structured remote/salary aren't exposed; location comes from embedded schema.org.
export const teamtailor: Connector = {
  provider: "teamtailor",
  endpoint: (slug) => `https://${slug}.teamtailor.com/jobs.json`,
  async fetchPostings(slug) {
    const res = await fetch(teamtailor.endpoint(slug), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`teamtailor ${slug} HTTP ${res.status}`);
    const data = (await res.json()) as { items?: TtItem[] };

    return (data.items ?? [])
      .map((it): RawPosting => ({
        externalId: it.id,
        title: it.title.trim(),
        descriptionHtml: it.content_html,
        descriptionText: it.content_html ? stripHtml(it.content_html) : undefined,
        applyUrl: it.url,
        locationRaw: ttLocation(it._jobposting),
        postedAt: it.date_published,
      }))
      .filter((p) => p.applyUrl.length > 0);
  },
};
