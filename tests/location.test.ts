import { describe, expect, it } from "vitest";
import { parseLocation } from "../engine/src/pipeline/location.ts";

describe("parseLocation", () => {
  it("treats a bare multi-country region as remote, not on-site", () => {
    // These name a hiring territory, not a workplace; defaulting them to
    // "onsite" put an On-site badge on roles whose location is "Europe".
    for (const raw of ["Europe", "AMER", "NAMER", "Americas", "North America", "EMEA"]) {
      expect(parseLocation(raw).remoteType).toBe("remote");
    }
  });

  it("still treats a country or city as on-site", () => {
    expect(parseLocation("Spain").remoteType).toBe("onsite");
    expect(parseLocation("San Francisco").remoteType).toBe("onsite");
  });

  it("reads the synonyms for remote as remote", () => {
    // Only "remote" and "hybrid" were tested for, so "Virtual" fell through to
    // the on-site default and put an On-site badge on a fully-virtual role.
    for (const raw of ["Virtual", "WFH", "Work from home", "Telecommute"]) {
      expect(parseLocation(raw).remoteType, raw).toBe("remote");
    }
    // Hybrid still wins where both could apply.
    expect(parseLocation("Hybrid").remoteType).toBe("hybrid");
    // …and a real place is untouched by the new vocabulary.
    expect(parseLocation("Virginia Beach").remoteType).toBe("onsite");
  });

  it("resolves countries from city and country names", () => {
    expect(parseLocation("Spain").country).toBe("ES");
    expect(parseLocation("San Francisco").country).toBe("US");
    expect(parseLocation("Remote - US").country).toBe("US");
  });

  it("falls back to the canonicalized city when the raw string hides the place", () => {
    // Feeds write the office, not the city. The hint table cannot match "sf" or
    // "NYC Office", but canonicalCity has already turned them into real city
    // names by the time the country is inferred — and without a country a role
    // publishes no JobPosting at all.
    const cases: [string, string][] = [
      ["sf", "US"],
      ["SF Office", "US"],
      ["NYC Office", "US"],
      ["SF Headquarters", "US"],
      ["Glasgow Campus", "GB"],
    ];
    for (const [raw, country] of cases) expect(parseLocation(raw).country, raw).toBe(country);
  });

  it("reads a two-letter code as the country's own region, not a US state", () => {
    // Why the US-state check runs after the hint table rather than before it:
    // in this corpus UT is Utrecht, CT is Catalonia, ON is Ontario and IN is
    // India far more often than they are Utah, Connecticut, Ontario NY or
    // Indiana. Reordering the two reads all four as American.
    expect(parseLocation("Nieuwegein, UT, Netherlands").country).toBe("NL");
    expect(parseLocation("Barcelona, CT, Spain").country).toBe("ES");
    expect(parseLocation("Toronto, ON, CA, Remote, Canada").country).toBe("CA");
    expect(parseLocation("IN-Bengaluru").country).toBe("IN");
  });

  it("adds a country from the city but never overturns one", () => {
    // The fallback fires only where the raw string yielded nothing, so a feed
    // that names its country keeps it whatever the city suggests.
    expect(parseLocation("Cambridge").country).toBeUndefined();
    expect(parseLocation("Cambridge, MA").country).toBe("US");
    expect(parseLocation("Cambridge, UK").country).toBe("GB");
  });

  it("covers the UK cities the hint table had skipped", () => {
    for (const [raw, country] of [
      ["Belfast", "GB"],
      ["Glasgow", "GB"],
      ["Leeds", "GB"],
      ["Cardiff", "GB"],
    ] as [string, string][]) {
      expect(parseLocation(raw).country, raw).toBe(country);
    }
  });

  it("leaves an ambiguous city's country unset rather than guessing", () => {
    // Both have a well-known US namesake, so neither can be claimed for the UK
    // on the city name alone.
    expect(parseLocation("Birmingham").country).toBeUndefined();
    expect(parseLocation("Cambridge").country).toBeUndefined();
  });

  it("leaves country unset when the feed gives no usable signal", () => {
    for (const raw of ["Remote", "Europe", "AMER", ""]) {
      expect(parseLocation(raw).country).toBeUndefined();
    }
  });

  // A segment used to yield no city at all if it merely *contained* a policy
  // word, which threw away the place name beside it. With no city, region or
  // country the site emits no JobPosting, so those roles were invisible to
  // Google for Jobs.
  it("keeps the place name when a work-policy word sits beside it", () => {
    const cases: [string, string][] = [
      ["San Carlos  - Hybrid", "San Carlos"],
      ["New York - Hybrid", "New York"],
      ["Hybrid - Lisbon, Portugal", "Lisbon"],
      ["Onsite - Austin, TX", "Austin"],
      ["Remote - Singapore", "Singapore"],
      ["Hybrid London", "London"],
      ["Hybrid Paris", "Paris"],
      ["San Francisco (Hybrid)", "San Francisco"],
      ["San Francisco (Remote)", "San Francisco"],
      ["Hybrid SF/Bay Area", "San Francisco"],
      ["SF Office", "San Francisco"],
      ["SF Headquarters", "San Francisco"],
    ];
    for (const [raw, city] of cases) expect(parseLocation(raw).city).toBe(city);
  });

  // The blunt version of the fix above turned "Remote job" into the city "Job".
  // A wrong city is worse than none: it reaches addressLocality, the city
  // filter, and — twelve deep — its own landing page.
  it("emits no city when stripping the policy word leaves something that isn't a place", () => {
    const raws = [
      "Remote",
      "Hybrid",
      "Virtual",
      "Remote job",
      "Remote - EST", // timezone
      "Remote - CA", // state code
      "Remote - U.S, Ann Arbor, MI", // country abbreviation
      "Remote-Friendly (Travel-Required) | San Francisco, CA",
      "Anywhere in the US",
      "Work from Home, United States",
      "PL-Poland-Remote", // hyphen belongs to the name, not a separator
      "Europe",
      "Remote - International ",
    ];
    for (const raw of raws) expect(parseLocation(raw).city).toBeUndefined();
  });

  it("does not split a hyphenated place name", () => {
    expect(parseLocation("Kitchener-Waterloo").city).toBe("Kitchener-Waterloo");
  });
});
