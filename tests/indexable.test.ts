import { describe, expect, it } from "vitest";
import type { Job, SiteSnapshot } from "@aiengjobs/shared";
import { MAX_JOB_AGE_DAYS, indexableSlugs, listedJobs } from "@aiengjobs/shared/indexable";

const GENERATED_AT = "2026-08-12T00:00:00Z";

const daysAgo = (n: number): string =>
  new Date(Date.parse(GENERATED_AT) - n * 86_400_000).toISOString();

function job(slug: string, over: Partial<Job> = {}): Job {
  return {
    slug,
    companyName: "Acme",
    companySlug: "acme",
    title: "AI Engineer",
    normalizedTitle: "ai engineer",
    applyUrl: `https://acme.example/${slug}`,
    city: "London",
    country: "GB",
    remoteType: "onsite",
    skills: [],
    clusters: [],
    postedAt: daysAgo(1),
    ingestedAt: daysAgo(1),
    ...over,
  };
}

const snapshot = (jobs: Job[]): SiteSnapshot => ({
  generatedAt: GENERATED_AT,
  fxRates: {},
  jobs,
  companies: [],
});

describe("listedJobs", () => {
  it("drops closed roles, aged-out roles and roles with no posted date", () => {
    const slugs = listedJobs(
      snapshot([
        job("fresh"),
        job("closed", { isClosed: true }),
        job("aged", { postedAt: daysAgo(MAX_JOB_AGE_DAYS + 1) }),
        job("undated", { postedAt: undefined }),
      ]),
    ).map((j) => j.slug);

    expect(slugs).toEqual(["fresh"]);
  });

  it("keeps a role sitting exactly on the age cutoff", () => {
    const slugs = listedJobs(
      snapshot([job("borderline", { postedAt: daysAgo(MAX_JOB_AGE_DAYS) })]),
    ).map((j) => j.slug);

    expect(slugs).toEqual(["borderline"]);
  });

  it("orders newest first", () => {
    const slugs = listedJobs(
      snapshot([
        job("older", { postedAt: daysAgo(10) }),
        job("newest", { postedAt: daysAgo(1) }),
        job("middle", { postedAt: daysAgo(5) }),
      ]),
    ).map((j) => j.slug);

    expect(slugs).toEqual(["newest", "middle", "older"]);
  });
});

describe("indexableSlugs", () => {
  it("keeps only the newest of several identical requisitions", () => {
    // Same title, company and raw location — the case the duplicate rule exists
    // for. The losers stay live but render without JobPosting markup, so
    // submitting them to Google would be submitting a page it can't use.
    const idx = indexableSlugs(
      snapshot([
        job("req-old", { locationRaw: "Hyderabad, India", postedAt: daysAgo(9) }),
        job("req-new", { locationRaw: "Hyderabad, India", postedAt: daysAgo(2) }),
        job("req-mid", { locationRaw: "Hyderabad, India", postedAt: daysAgo(5) }),
      ]),
    );

    expect([...idx]).toEqual(["req-new"]);
  });

  it("treats a different raw location as a different role, not a duplicate", () => {
    const idx = indexableSlugs(
      snapshot([
        job("london", { locationRaw: "London, UK" }),
        job("berlin", { locationRaw: "Berlin, Germany", city: "Berlin", country: "DE" }),
      ]),
    );

    expect([...idx].sort()).toEqual(["berlin", "london"]);
  });

  it("excludes roles Google could not resolve a location for", () => {
    // Distinct locationRaw throughout, so the duplicate rule stays out of the
    // way and each role is judged on its location alone.
    const idx = indexableSlugs(
      snapshot([
        job("located", { locationRaw: "London, UK" }),
        job("nowhere", {
          locationRaw: undefined,
          city: undefined,
          region: undefined,
          country: undefined,
        }),
        // Remote roles need a country specifically — a city alone can't become
        // applicantLocationRequirements.
        job("remote-with-country", {
          locationRaw: "Remote (UK)",
          remoteType: "remote",
          city: undefined,
        }),
        job("remote-no-country", {
          locationRaw: "Remote (anywhere)",
          remoteType: "remote",
          country: undefined,
        }),
      ]),
    );

    expect([...idx].sort()).toEqual(["located", "remote-with-country"]);
  });

  it("excludes an on-site role that knows its city but not its country", () => {
    // addressCountry is the only required field of jobLocation.address, so a
    // city on its own builds a PostalAddress Search Console rejects: "Missing
    // field addressCountry (in jobLocation.address)" — 46 live roles were
    // publishing exactly that. No country, no markup.
    const idx = indexableSlugs(
      snapshot([
        job("city-and-country", { locationRaw: "Belfast, UK" }),
        job("city-only", { locationRaw: "Tysons", city: "Tysons", country: undefined }),
        job("region-only", {
          locationRaw: "Bavaria",
          city: undefined,
          region: "Bavaria",
          country: undefined,
        }),
        // No city, but a country is enough on its own — an address of nothing
        // but addressCountry is valid.
        job("country-only", { locationRaw: "Japan", city: undefined, country: "JP" }),
      ]),
    );

    expect([...idx].sort()).toEqual(["city-and-country", "country-only"]);
  });

  it("excludes tombstones — closed and aged-out roles alike", () => {
    const idx = indexableSlugs(
      snapshot([
        job("open"),
        job("closed", { isClosed: true }),
        job("aged", { postedAt: daysAgo(MAX_JOB_AGE_DAYS + 5) }),
      ]),
    );

    expect([...idx]).toEqual(["open"]);
  });
});
