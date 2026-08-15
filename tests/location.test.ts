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
