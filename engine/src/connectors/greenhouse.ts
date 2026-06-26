import type { Connector, RawPosting } from "./types.ts";
import { USER_AGENT, decodeEntities, stripHtml } from "../util/html.ts";

interface GhJob {
  id: number;
  title: string;
  location?: { name?: string };
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  content?: string; // HTML-entity-encoded
}

// Greenhouse public board API (spec §6.1) — widest tech coverage.
export const greenhouse: Connector = {
  provider: "greenhouse",
  endpoint: (slug) =>
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  async fetchPostings(slug) {
    const res = await fetch(greenhouse.endpoint(slug), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`greenhouse ${slug} HTTP ${res.status}`);
    const data = (await res.json()) as { jobs?: GhJob[] };

    return (data.jobs ?? []).map((j): RawPosting => {
      const html = j.content ? decodeEntities(j.content) : undefined;
      return {
        externalId: String(j.id),
        title: j.title.trim(),
        descriptionHtml: html,
        descriptionText: html ? stripHtml(html) : undefined,
        applyUrl: j.absolute_url,
        locationRaw: j.location?.name,
        postedAt: j.first_published,
        updatedAt: j.updated_at,
      };
    });
  },
};
