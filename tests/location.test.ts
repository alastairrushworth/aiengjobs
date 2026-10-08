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

  it("places the cities and countries the hint table had skipped", () => {
    // Each was a live role with no country, and so no JobPosting.
    const cases: [string, string][] = [
      ["Almaty, Kazakhstan", "KZ"],
      ["Bochum", "DE"],
      ["Farringdon", "GB"],
      ["Canary Wharf, 1 Churchill Place", "GB"],
      ["BELO HORIZONTE", "BR"],
      ["Lehi", "US"],
      ["Alpharetta, Georgia", "US"],
      ["ALPHARETTA, GEORGIA", "US"],
      ["Knutsford, Radbroke Hall", "GB"],
      ["Shanghai_Tianshan", "CN"],
      ["KATO SCHOLARI 01", "GR"],
      ["DLF CYBERCITY 12B", "IN"],
      ["Doha, Qatar", "QA"],
      ["Quito, Ecuador", "EC"],
      ["Lima, Peru", "PE"],
      ["Heredia, Heredia, Costa Rica", "CR"],
      ["Bogotá", "CO"],
    ];
    for (const [raw, country] of cases) expect(parseLocation(raw).country, raw).toBe(country);
    expect(parseLocation("Alpharetta, Georgia")).toMatchObject({ city: "Alpharetta", region: "GA" });
    expect(parseLocation("Farringdon").city).toBe("London");
  });

  it("reads a standalone ISO alpha-3 code as the country it spells", () => {
    const cases: [string, string][] = [
      ["Ontario, CAN", "CA"],
      ["Mohali, IND", "IN"],
      ["IND-BLR-Divyasree Technopolis", "IN"],
      ["PHL-Taguig City-CitiPlaza", "PH"],
      ["VNM.Da Nang", "VN"],
      ["Remote AUS", "AU"],
    ];
    for (const [raw, country] of cases) expect(parseLocation(raw).country, raw).toBe(country);
    // EST is the timezone on this board, never Estonia; lowercase words and
    // codes inside a longer token are not codes.
    expect(parseLocation("Remote - EST").country).toBeUndefined();
    expect(parseLocation("Remote, can relocate").country).toBeUndefined();
    expect(parseLocation("INDIGO").country).toBeUndefined();
  });

  it("still leaves the ambiguous names without a country", () => {
    // Each names a real city in two countries: San Carlos (California, and the
    // Philippines, Uruguay, Costa Rica…), Halifax (Nova Scotia, Yorkshire),
    // Markham (Ontario, Illinois), Sault Ste. Marie (Ontario, Michigan), St.
    // John's (Newfoundland, Antigua), Lima (Peru, Ohio).
    for (const raw of [
      "San Carlos - Hybrid",
      "Halifax",
      "Markham",
      "Sault Ste. Marie",
      "St. John's",
      "Lima",
      "Remote - Ontario",
    ]) {
      expect(parseLocation(raw).country, raw).toBeUndefined();
    }
  });
});

describe("parseLocation broad → narrow", () => {
  // Workday tenants write the state or country first. Reading the first
  // segment as the city published Expedia's Seattle roles as Washington, DC
  // and Equifax's Alpharetta roles in a city called Georgia.
  it("reads the city after a leading US state", () => {
    const cases: [raw: string, city: string, region: string][] = [
      ["Washington - Seattle Campus", "Seattle", "WA"],
      ["Washington - Bellevue", "Bellevue", "WA"],
      ["USA - Georgia - Alpharetta - 30005", "Alpharetta", "GA"],
      ["Georgia - Atlanta", "Atlanta", "GA"],
      ["California - San Francisco", "San Francisco", "CA"],
      ["USA - Illinois - Chicago", "Chicago", "IL"],
      ["Virginia - Herndon", "Herndon", "VA"],
      ["AMER - United States - Oregon - Portland", "Portland", "OR"],
    ];
    for (const [raw, city, region] of cases) {
      expect(parseLocation(raw), raw).toMatchObject({ country: "US", city, region });
    }
  });

  it("reads the city after a leading country, code or province", () => {
    const cases: [raw: string, country: string, city: string, region?: string][] = [
      ["Canada, BC, Vancouver", "CA", "Vancouver", "BC"],
      ["USA, CA, Pleasanton", "US", "Pleasanton", "CA"],
      ["CAN - Ontario - Toronto", "CA", "Toronto", "ON"],
      ["AMER - Canada - Ontario - Toronto - University Ave", "CA", "Toronto", "ON"],
      ["EMEA - United Kingdom - London - Agar St", "GB", "London"],
      ["Ireland, Dublin", "IE", "Dublin"],
      ["Israel, Tel Aviv", "IL", "Tel Aviv"],
      ["Lithuania - Vilnius", "LT", "Vilnius"],
      ["India (Bengaluru)", "IN", "Bangalore", "Karnataka"],
    ];
    for (const [raw, country, city, region] of cases) {
      const got = parseLocation(raw);
      expect(got, raw).toMatchObject({ country, city });
      expect(got.region, raw).toBe(region);
    }
  });

  it("still reads Washington, DC as the city", () => {
    for (const raw of [
      "Washington, DC",
      "Washington D.C.",
      "Washington, D.C.",
      "Washington DC",
      "Washington - DC",
      "Washington, District of Columbia, United States",
    ]) {
      expect(parseLocation(raw), raw).toMatchObject({ country: "US", city: "Washington" });
    }
  });

  it("does not read past a city that is also a state when a comma follows it", () => {
    // Before a comma "New York" is the first city of a list far more often
    // than it is the state.
    expect(parseLocation("New York, London, Chicago").city).toBe("New York");
    expect(parseLocation("New York, New York").city).toBe("New York");
    expect(parseLocation("New York - Hybrid").city).toBe("New York");
  });

  it("emits no city when what follows the broad side is not a city", () => {
    for (const raw of [
      "US, UK, Singapore, Remote", // a list of countries, not a nest
      "Colombia, Huila, Colombia", // City-Region-Country, reversed
      "Americas (US time zones)",
      "IND - India - Home based",
      "AMER - Canada - Ontario - Offsite/Home",
      "USA, Washington", // the last segment is the state itself
      "India, Delhi",
      "135 W 26th Street, New York, NY 10001", // an address, left alone
    ]) {
      expect(parseLocation(raw).city, raw).toBeUndefined();
    }
  });

  it("reads Georgia as the country when a Georgian city follows it", () => {
    // The bare word is never a country hint; Tbilisi is.
    expect(parseLocation("Georgia - Tbilisi")).toMatchObject({ country: "GE", city: "Tbilisi" });
    expect(parseLocation("Tbilisi, Georgia")).toMatchObject({ country: "GE", city: "Tbilisi" });
    expect(parseLocation("Georgia - Atlanta")).toMatchObject({ country: "US", region: "GA", city: "Atlanta" });
    expect(parseLocation("Atlanta, Georgia")).toMatchObject({ country: "US", region: "GA", city: "Atlanta" });
    // Alone it names neither a city nor a country.
    expect(parseLocation("Georgia").city).toBeUndefined();
    expect(parseLocation("Georgia").country).toBeUndefined();
  });

  it("leaves a codes-only prefix to canonicalCity's code loop", () => {
    expect(parseLocation("CN - Shanghai").city).toBe("Shanghai");
    expect(parseLocation("VA - Reston, 11951 Freedom Dr").city).toBe("Reston");
    expect(parseLocation("IND - NonGBS-Pune-Kharadi")).toMatchObject({
      country: "IN",
      region: "Maharashtra",
      city: "Pune",
    });
  });
});
