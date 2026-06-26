import type { Connector } from "./types.ts";

// Ashby public job-board API (spec §6.1) — cleanest compensation data. Prioritise
// for the salary filter. includeCompensation=true returns structured comp.
// GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
export const ashby: Connector = {
  provider: "ashby",
  endpoint: (slug) =>
    `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
  async fetchPostings(slug) {
    // TODO Phase 1: fetch; map jobs[] -> RawPosting, parsing compensation[] for
    //   salary_min/max/currency/period (prefer structured over regex).
    void slug;
    return [];
  },
};
