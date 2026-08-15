import { describe, expect, it } from "vitest";
import { canonicalCity, citySlug } from "../shared/city.ts";

describe("canonicalCity", () => {
  it("passes clean city names through unchanged", () => {
    expect(canonicalCity("San Francisco")).toBe("San Francisco");
    expect(canonicalCity("London")).toBe("London");
    expect(canonicalCity("Palo Alto")).toBe("Palo Alto");
  });

  it("rejects placeholders that would become a bogus addressLocality", () => {
    // The literal string "null" reaches us from the LLM extractor.
    expect(canonicalCity("null")).toBeUndefined();
    expect(canonicalCity("undefined")).toBeUndefined();
    expect(canonicalCity("Headquarters")).toBeUndefined();
    expect(canonicalCity("Remote")).toBeUndefined();
    expect(canonicalCity("N/A")).toBeUndefined();
    expect(canonicalCity("")).toBeUndefined();
    expect(canonicalCity(undefined)).toBeUndefined();
    expect(canonicalCity(null)).toBeUndefined();
  });

  it("rejects countries, regions and US states", () => {
    expect(canonicalCity("USA")).toBeUndefined();
    expect(canonicalCity("Europe")).toBeUndefined();
    expect(canonicalCity("EMEA")).toBeUndefined();
    expect(canonicalCity("California")).toBeUndefined();
    expect(canonicalCity("Sweden")).toBeUndefined();
  });

  it("merges duplicate spellings of the same place", () => {
    expect(canonicalCity("New York City")).toBe("New York");
    expect(canonicalCity("NYC")).toBe("New York");
    expect(canonicalCity("Bengaluru")).toBe("Bangalore");
    expect(canonicalCity("Gurugram")).toBe("Gurgaon");
    expect(canonicalCity("Zürich")).toBe("Zurich");
    expect(canonicalCity("München")).toBe("Munich");
  });

  it("collapses metro-area strings onto the principal city", () => {
    expect(canonicalCity("Bay Area")).toBe("San Francisco");
    expect(canonicalCity("San Francisco Bay Area")).toBe("San Francisco");
  });

  it("strips country and state prefixes", () => {
    expect(canonicalCity("UK - London")).toBe("London");
    expect(canonicalCity("US-CA-Menlo Park")).toBe("Menlo Park");
    expect(canonicalCity("US-WA-Bellevue")).toBe("Bellevue");
    expect(canonicalCity("India - Bangalore")).toBe("Bangalore");
  });

  it("strips office, building and street detail", () => {
    expect(canonicalCity("London - The River Building HQ")).toBe("London");
    expect(canonicalCity("Hyderabad - Phoenix Equinox Tower 2")).toBe("Hyderabad");
    expect(canonicalCity("New York Office")).toBe("New York");
    expect(canonicalCity("Berlin Office")).toBe("Berlin");
    expect(canonicalCity("Freiburg (Germany)")).toBe("Freiburg");
    expect(canonicalCity("GA Atlanta 1050 Techwood Drive NW")).toBe("Atlanta");
  });

  it("takes the first of several listed cities", () => {
    expect(canonicalCity("Chicago; New York")).toBe("Chicago");
    expect(canonicalCity("London | Paris")).toBe("London");
  });

  it("normalizes case without mangling intentional mixed case", () => {
    expect(canonicalCity("SAN JOSE")).toBe("San Jose");
    expect(canonicalCity("san jose")).toBe("San Jose");
    expect(canonicalCity("McLean")).toBe("McLean");
    expect(canonicalCity("São Paulo")).toBe("São Paulo");
  });

  it("does not split hyphenated place names", () => {
    expect(canonicalCity("Kitchener-Waterloo")).toBe("Kitchener-Waterloo");
    expect(canonicalCity("Tel Aviv-Yafo")).toBe("Tel Aviv");
  });

  // All of these were reaching `addressLocality` in the published JobPosting
  // markup — 29 canonical roles across 19 distinct junk values.
  it("strips stacked location codes whatever separates them", () => {
    expect(canonicalCity("USA.VA.Reston")).toBe("Reston");
    expect(canonicalCity("IND.Pune")).toBe("Pune");
    expect(canonicalCity("VNM.Da Nang")).toBe("Da Nang");
    expect(canonicalCity("IND:AP:Hyderabad")).toBe("Hyderabad");
    expect(canonicalCity("NLD Amsterdam")).toBe("Amsterdam");
  });

  it("keeps only the city from a COUNTRY-City-Site feed code", () => {
    expect(canonicalCity("IND-Bangalore-TowerE")).toBe("Bangalore");
    expect(canonicalCity("IND-Bangalore-A")).toBe("Bangalore");
    expect(canonicalCity("AUS-Sydney-Blue-Street")).toBe("Sydney");
    expect(canonicalCity("CHN-Beijing-Oriental Plaza")).toBe("Beijing");
    expect(canonicalCity("PHL-Taguig City-CitiPlaza")).toBe("Taguig City");
    expect(canonicalCity("IND-Pune-Equifax Analytics-PEC")).toBe("Pune");
  });

  it("strips a site word attached by a hyphen, not just a space", () => {
    expect(canonicalCity("Bengaluru-HQ")).toBe("Bangalore"); // via the alias
    expect(canonicalCity("Montreal-HQ")).toBe("Montreal");
  });

  it("rejects a building name standing in for a city", () => {
    expect(canonicalCity("IND-BLR-Divyasree Technopolis")).toBeUndefined();
    expect(canonicalCity("London The Stanley Building")).toBeUndefined();
    expect(canonicalCity("Bengaluru Luxor North Tower")).toBeUndefined();
    expect(canonicalCity("Bengaluru-EPIP Industrial Area")).toBeUndefined();
    expect(canonicalCity("*hq")).toBeUndefined();
    // …but the metro-area aliases end in the same word and must still resolve.
    expect(canonicalCity("Bay Area")).toBe("San Francisco");
    expect(canonicalCity("SAN FRANCISCO BAY AREA")).toBe("San Francisco");
  });

  it("takes the first city of an either/or location", () => {
    expect(canonicalCity("SF or NYC")).toBe("San Francisco");
    expect(canonicalCity("San Francisco or NYC")).toBe("San Francisco");
  });

  // The whole risk of the rules above: they must not eat real names that
  // happen to look like codes or site detail. A throwaway version of this fix
  // turned every one of these into rubble.
  it("leaves real place names that look like codes or site detail alone", () => {
    expect(canonicalCity("Sault Ste. Marie")).toBe("Sault Ste. Marie");
    expect(canonicalCity("St. Louis")).toBe("Saint Louis");
    expect(canonicalCity("ST. LOUIS")).toBe("Saint Louis");
    expect(canonicalCity("Ramat Gan")).toBe("Ramat Gan");
    expect(canonicalCity("Le Plessis-Robinson")).toBe("Le Plessis-Robinson");
    expect(canonicalCity("Menlo Park")).toBe("Menlo Park");
    expect(canonicalCity("Kitchener-Waterloo")).toBe("Kitchener-Waterloo");
    // "SF" is a known city, so it survives the code loop and the site word
    // after it is what gets stripped.
    expect(canonicalCity("SF Office")).toBe("San Francisco");
  });

  it("is idempotent — safe to apply at ingest and again at export", () => {
    for (const raw of [
      "UK - London",
      "New York City",
      "SAN JOSE",
      "Bay Area",
      "Kitchener-Waterloo",
      "São Paulo",
      "McLean",
    ]) {
      const once = canonicalCity(raw);
      expect(canonicalCity(once)).toBe(once);
    }
  });
});

describe("citySlug", () => {
  it("folds diacritics and punctuation into a URL-safe slug", () => {
    expect(citySlug("San Francisco")).toBe("san-francisco");
    expect(citySlug("São Paulo")).toBe("sao-paulo");
    expect(citySlug("Kitchener-Waterloo")).toBe("kitchener-waterloo");
    expect(citySlug("Zurich")).toBe("zurich");
  });
});

describe("multi-country regions", () => {
  it("never yields a city name", () => {
    // "AMER" title-cased to "Amer" and shipped as addressLocality in the
    // JobPosting markup — a country that does not exist.
    for (const raw of ["AMER", "NAMER", "EMEA", "APAC", "EU", "ANZ", "LATAM", "Americas"]) {
      expect(canonicalCity(raw)).toBeUndefined();
    }
  });

  it("does not swallow real cities", () => {
    // Countries were already excluded (they're not cities); the new region
    // entries must not have widened that to genuine place names.
    expect(canonicalCity("San Francisco")).toBe("San Francisco");
    expect(canonicalCity("Amersfoort")).toBe("Amersfoort");
    expect(canonicalCity("Seattle")).toBe("Seattle");
  });
});

describe("placeholder locations never become a city", () => {
  it("rejects the placeholders seen in the live snapshot", () => {
    // These reached `city` and rendered verbatim in <title> ("· Any location")
    // and in the job page's Location fact. Two Coalition postings also shared a
    // title because jobTitle.ts disambiguates on city and both said the same
    // non-answer.
    for (const raw of [
      "Any location",
      "In-Office",
      "Office",
      "US and Canada Offices",
      "Home Or",
      "Remote Office",
      "Main (Hybrid)",
      "Virtual",
      "HQ",
    ]) {
      expect(canonicalCity(raw), raw).toBeUndefined();
    }
  });

  it("is case- and whitespace-insensitive about them", () => {
    expect(canonicalCity("  any LOCATION  ")).toBeUndefined();
    expect(canonicalCity("IN-OFFICE")).toBeUndefined();
  });

  it("still accepts real cities that merely contain a placeholder word", () => {
    expect(canonicalCity("Officer Falls")).toBe("Officer Falls");
    expect(canonicalCity("Homestead")).toBe("Homestead");
  });
});
