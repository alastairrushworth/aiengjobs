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

// Greenhouse serves EU-data-residency boards from a separate API host
// (boards-api.eu.greenhouse.io, fronted by job-boards.eu.greenhouse.io). Those
// boards 404 on the default US host, so we fall back to the EU host on a 404.
const GH_HOSTS = ["boards-api.greenhouse.io", "boards-api.eu.greenhouse.io"];
const boardUrl = (host: string, slug: string) =>
  `https://${host}/v1/boards/${slug}/jobs?content=true`;

// Greenhouse public board API (spec §6.1) — widest tech coverage.
export const greenhouse: Connector = {
  provider: "greenhouse",
  endpoint: (slug) => boardUrl(GH_HOSTS[0], slug),
  async fetchPostings(slug) {
    let res: Response | undefined;
    for (const host of GH_HOSTS) {
      res = await fetch(boardUrl(host, slug), {
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.ok) break;
      // Only a 404 means "not on this host" — try the next. Other errors are real.
      if (res.status !== 404) break;
    }
    if (!res || !res.ok) throw new Error(`greenhouse ${slug} HTTP ${res?.status}`);
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
