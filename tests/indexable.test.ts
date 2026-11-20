import { describe, expect, it } from "vitest";
import type { Job, SiteSnapshot } from "@aiengjobs/shared";
import {
  MAX_JOB_AGE_DAYS,
  canonicalByDupKey,
  duplicateOfIn,
  indexableSlugs,
  listedJobs,
} from "@aiengjobs/shared/indexable";

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
  it("drops closed, delisted and aged-out roles, and roles with no posted date", () => {
    const slugs = listedJobs(
      snapshot([
        job("fresh"),
        job("closed", { isClosed: true }),
        job("delisted", { isDelisted: true }),
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

  describe("one advert reposted per city", () => {
    const ADVERT = "Build the data pipelines behind our speech models. ".repeat(8);
    const repost = (slug: string, city: string, over: Partial<Job> = {}): Job =>
      job(slug, {
        title: `Software Engineer, AI Data - ${city}`,
        locationRaw: "Remote",
        remoteType: "remote",
        descriptionText: ADVERT,
        ...over,
      });

    it("folds postings that differ only in the place written into the title", () => {
      // Speechify, 2026-11-20: 144 of these under one location and one text.
      const idx = indexableSlugs(
        snapshot([
          repost("vegas", "Las Vegas, NV, USA", { postedAt: daysAgo(3) }),
          repost("dallas", "Dallas, TX, USA", { postedAt: daysAgo(1) }),
          repost("knoxville", "Knoxville, TN, USA", { postedAt: daysAgo(2) }),
        ]),
      );

      expect([...idx]).toEqual(["dallas"]);
    });

    it("ignores whitespace differences in the description", () => {
      const idx = indexableSlugs(
        snapshot([
          repost("a", "Austin, TX, USA", { postedAt: daysAgo(1) }),
          repost("b", "Boise, ID, USA", {
            postedAt: daysAgo(2),
            descriptionText: `  ${ADVERT.replace(/ /g, "\n")}`,
          }),
        ]),
      );

      expect([...idx]).toEqual(["a"]);
    });

    it("keeps postings whose description differs — the suffix is a team, or the pay band changed", () => {
      // "Software Engineer - Inference Product" and "- Storage Systems" are two
      // jobs; so are Speechify's per-country adverts, which differ only in pay.
      const idx = indexableSlugs(
        snapshot([
          repost("us", "Austin, TX, USA"),
          repost("pl", "Warsaw, Poland", { descriptionText: `${ADVERT} Pay: $30,000-$110,000.` }),
        ]),
      );

      expect([...idx].sort()).toEqual(["pl", "us"]);
    });

    it("keeps different roles that merely share a boilerplate description", () => {
      // Field AI: 17 distinct titles in Irvine under one text.
      const idx = indexableSlugs(
        snapshot([
          job("manip", { title: "Robotics Autonomy Engineer, Manipulation", descriptionText: ADVERT }),
          job("vlm", { title: "Robotics Software Engineer, Vision-Language", descriptionText: ADVERT }),
          job("ml", { title: "Staff Engineer - ML Platform", descriptionText: ADVERT }),
          job("infra", { title: "Senior Engineer - ML Platform", descriptionText: ADVERT }),
        ]),
      );

      expect([...idx].sort()).toEqual(["infra", "manip", "ml", "vlm"]);
    });

    it("keeps a repost filed under a different location or employer", () => {
      const idx = indexableSlugs(
        snapshot([
          repost("remote", "Leeds, United Kingdom"),
          repost("onsite", "York, United Kingdom", { locationRaw: "York, UK" }),
          repost("rival", "Bath, United Kingdom", { companySlug: "other", companyName: "Other" }),
        ]),
      );

      expect([...idx].sort()).toEqual(["onsite", "remote", "rival"]);
    });

    it("needs a description to compare — a missing one vouches for nothing", () => {
      const idx = indexableSlugs(
        snapshot([
          repost("x", "Leeds, United Kingdom", { descriptionText: undefined }),
          repost("y", "York, United Kingdom", { descriptionText: undefined }),
          repost("z", "Bath, United Kingdom", { descriptionText: "Apply now." }),
          repost("w", "Hull, United Kingdom", { descriptionText: "Apply now." }),
        ]),
      );

      expect(idx.size).toBe(4);
    });

    it("resolves a chain through both rules to the one newest posting", () => {
      // "old" duplicates "mid" by title; "mid" is a repost of "new". Every
      // member has to land on "new" — a canonical that itself points elsewhere
      // is a chain, which Google is free to ignore.
      const listed = listedJobs(
        snapshot([
          repost("old", "Austin, TX, USA", { postedAt: daysAgo(9), descriptionText: `${ADVERT} v1` }),
          repost("mid", "Austin, TX, USA", { postedAt: daysAgo(5) }),
          repost("new", "Boise, ID, USA", { postedAt: daysAgo(1) }),
        ]),
      );
      const canonical = canonicalByDupKey(listed);

      expect(listed.map((j) => duplicateOfIn(canonical, j))).toEqual([null, "new", "new"]);
    });

    it("merges two sets when a later posting belongs to both", () => {
      // "a" and "b" start as separate sets (different title, different text).
      // "c" shares a title with "a" and a text with "b", which makes all three
      // one job — and the newest of the three its canonical.
      const listed = listedJobs(
        snapshot([
          repost("a", "Austin, TX, USA", { postedAt: daysAgo(2), descriptionText: `${ADVERT} v1` }),
          repost("b", "Boise, ID, USA", { postedAt: daysAgo(1) }),
          repost("c", "Austin, TX, USA", { postedAt: daysAgo(3) }),
        ]),
      );
      const canonical = canonicalByDupKey(listed);

      expect(listed.map((j) => [j.slug, duplicateOfIn(canonical, j)])).toEqual([
        ["b", null],
        ["a", "b"],
        ["c", "b"],
      ]);
    });
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

  it("excludes tombstones — closed, delisted and aged-out roles alike", () => {
    // Delisting strips the markup, so the engine must announce URL_DELETED
    // for it exactly as it does for a closure.
    const idx = indexableSlugs(
      snapshot([
        job("open"),
        job("closed", { isClosed: true }),
        job("delisted", { isDelisted: true }),
        job("aged", { postedAt: daysAgo(MAX_JOB_AGE_DAYS + 5) }),
      ]),
    );

    expect([...idx]).toEqual(["open"]);
  });
});
