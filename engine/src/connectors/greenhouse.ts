import type { Connector } from "./types.ts";

// Greenhouse public board API (spec §6.1) — widest tech coverage, easiest start.
// GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
export const greenhouse: Connector = {
  provider: "greenhouse",
  endpoint: (slug) =>
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  async fetchPostings(slug) {
    // TODO Phase 1: fetch this.endpoint(slug); map data.jobs[] -> RawPosting[]
    //   { externalId: id, title, descriptionHtml: content, applyUrl: absolute_url,
    //     locationRaw: location.name, updatedAt: updated_at }
    void slug;
    return [];
  },
};
