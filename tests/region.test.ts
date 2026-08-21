import { describe, expect, it } from "vitest";
import { inferRegion } from "../engine/src/pipeline/region.ts";
import { parseLocation } from "../engine/src/pipeline/location.ts";

describe("inferRegion", () => {
  it("reads the division named right after the city", () => {
    const cases: [raw: string, country: string, city: string, region: string][] = [
      ["Seattle, WA", "US", "Seattle", "WA"],
      ["Onsite - Austin, TX", "US", "Austin", "TX"],
      ["Coral Springs, Florida", "US", "Coral Springs", "FL"],
      ["Mountain View, CALIFORNIA, United States", "US", "Mountain View", "CA"],
      ["Bengaluru, Karnataka, India", "IN", "Bengaluru", "Karnataka"],
      ["Montreal, QUEBEC, Canada", "CA", "Montreal", "QC"],
      ["Sydney, NSW, Australia", "AU", "Sydney", "NSW"],
    ];
    for (const [raw, country, city, region] of cases) {
      expect(inferRegion(raw, country, city), raw).toBe(region);
    }
  });

  it("falls back to the division the city itself implies", () => {
    // Feeds very often write nothing but the place name. Half the on-site roles
    // on the board name no division at all.
    expect(inferRegion("Menlo Park", "US", "Menlo Park")).toBe("CA");
    expect(inferRegion("Hybrid Austin", "US", "Austin")).toBe("TX");
    expect(inferRegion("India - Pune", "IN", "Pune")).toBe("Maharashtra");
    expect(inferRegion("Toronto", "CA", "Toronto")).toBe("ON");
  });

  it("does not read a second city in a list as this city's region", () => {
    // "Chicago, New York, London" ends up in Illinois, and addressLocality will
    // say Chicago — an address whose locality and region disagree is worse than
    // one with no region at all.
    expect(inferRegion("Chicago, New York, London", "US", "Chicago")).toBe("IL");
    expect(inferRegion("San Francisco, CA; New York, NY", "US", "San Francisco")).toBe("CA");
  });

  it("reads a division only against its own country", () => {
    // "IN" is Indiana in the US and never India; "WA" is Washington there and
    // Western Australia in Australia.
    expect(inferRegion("Indianapolis, IN", "US", "Indianapolis")).toBe("IN");
    expect(inferRegion("Perth, WA", "AU", "Perth")).toBe("WA");
    expect(inferRegion("Seattle, WA", "US", "Seattle")).toBe("WA");
    // A country with no division table yields nothing rather than a guess.
    expect(inferRegion("Munich, BY, Germany", "DE", "Munich")).toBeUndefined();
    expect(inferRegion("Barcelona, CT, Spain", "ES", "Barcelona")).toBeUndefined();
  });

  it("yields nothing without a country to read the division against", () => {
    expect(inferRegion("Seattle, WA", undefined, "Seattle")).toBeUndefined();
  });

  it("rejects the junk a positional rule would have accepted", () => {
    // Each of these is a real board location that the rejected "segment between
    // city and country" rule turned into a region.
    for (const raw of [
      "San Francisco, CA - Hybrid",
      "Headquarters/Sunnyvale Office",
      "AMER - Canada - Ontario - Offsite/Home",
      "Sunnyvale, CA - US",
      "London / Bristol - Hybrid",
    ]) {
      const region = inferRegion(raw, "US", undefined);
      // Either nothing, or a real code — never "Ca - Hybrid" or "Home".
      if (region !== undefined) expect(region, raw).toMatch(/^[A-Z]{2,3}$/);
    }
    expect(inferRegion("Prague, Czech Republic", "CZ", "Prague")).toBeUndefined();
    expect(inferRegion("Bengaluru, IND", "IN", "Bengaluru")).toBe("Karnataka");
  });
});

describe("parseLocation region", () => {
  it("returns the region alongside the country and city", () => {
    expect(parseLocation("Austin, TX")).toMatchObject({
      remoteType: "onsite",
      country: "US",
      region: "TX",
      city: "Austin",
    });
  });

  it("leaves region unset when the country is unknown", () => {
    expect(parseLocation("Knutsford, Radbroke Hall").region).toBeUndefined();
  });
});
