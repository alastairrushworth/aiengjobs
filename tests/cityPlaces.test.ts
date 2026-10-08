import { describe, expect, it } from "vitest";
import type { Job } from "@aiengjobs/shared";
import { cityPlaces } from "../site/src/lib/cityPlaces.ts";

let n = 0;
const job = (over: Partial<Job> = {}): Job => ({
  slug: `job-${n++}`,
  companyName: "Co",
  companySlug: "co",
  title: "AI Engineer",
  normalizedTitle: "ai engineer",
  applyUrl: "https://x/apply",
  skills: [],
  clusters: [],
  ingestedAt: "2026-10-01T00:00:00Z",
  postedAt: "2026-10-01T00:00:00Z",
  ...over,
});

const many = (k: number, over: Partial<Job>) => Array.from({ length: k }, () => job(over));
const summary = (places: ReturnType<typeof cityPlaces>) =>
  places.map((p) => ({ city: p.city, country: p.country, twin: p.twin, shared: p.shared, n: p.jobs.length }));

describe("cityPlaces", () => {
  it("splits a name two countries really share, keeping the owner on the bare page", () => {
    const places = cityPlaces(
      [
        ...many(17, { city: "Cambridge", country: "US", companySlug: "lila", locationRaw: "Cambridge, MA" }),
        job({ city: "Cambridge", country: "GB", companySlug: "speechmatics", locationRaw: "Cambridge, UK" }),
        job({ city: "Cambridge", country: "GB", companySlug: "graphcore", locationRaw: "Cambridge, UK" }),
        // No country: can't be placed on either page once the name is split.
        job({ city: "Cambridge", companySlug: "healx", locationRaw: "Cambridge" }),
      ],
      // The owner's evidence needs two employers too.
      [job({ city: "Cambridge", country: "US", companySlug: "capitalone", locationRaw: "Cambridge, MA" })],
    );
    expect(summary(places)).toEqual([
      { city: "Cambridge", country: "US", twin: false, shared: true, n: 17 },
      { city: "Cambridge", country: "GB", twin: true, shared: true, n: 2 },
    ]);
    expect(places[0]!.recentlyClosed).toBe(1);
    expect(places[1]!.recentlyClosed).toBe(0);
  });

  it("keeps mislabels from multi-site postings on their city's page, however many", () => {
    // Amsterdam's GB roles were all "Amsterdam, Netherlands; …; London, United Kingdom".
    const places = cityPlaces(
      [
        job({ city: "Amsterdam", country: "NL", companySlug: "a", locationRaw: "Amsterdam" }),
        job({ city: "Amsterdam", country: "NL", companySlug: "b", locationRaw: "Amsterdam, NL" }),
        ...["nebius", "jetbrains", "c"].map((companySlug) =>
          job({
            city: "Amsterdam",
            country: "GB",
            companySlug,
            locationRaw: "Amsterdam, Netherlands; London, United Kingdom",
          }),
        ),
      ],
      [],
    );
    expect(summary(places)).toEqual([
      { city: "Amsterdam", country: "NL", twin: false, shared: false, n: 5 },
    ]);
  });

  it("needs independent employers: one ATS's default country is not a second city", () => {
    const places = cityPlaces(
      [
        ...many(5, { city: "Hyderabad", country: "IN", companySlug: "x", locationRaw: "Hyderabad" }),
        ...many(3, { city: "Hyderabad", country: "IN", companySlug: "y", locationRaw: "Hyderabad, India" }),
        ...many(4, { city: "Hyderabad", country: "US", companySlug: "wbd", locationRaw: "Hyderabad Tower 2" }),
      ],
      [],
    );
    expect(summary(places)).toEqual([
      { city: "Hyderabad", country: "IN", twin: false, shared: false, n: 12 },
    ]);
  });

  it("lets evidence, not a tied plurality, pick the owner", () => {
    const places = cityPlaces(
      [
        ...["p72", "jump", "q"].map((companySlug) =>
          job({ city: "Hong Kong", country: "SG", companySlug, locationRaw: "Hong Kong; Singapore" }),
        ),
        ...["janestreet", "qube", "okx"].map((companySlug) =>
          job({ city: "Hong Kong", country: "HK", companySlug, locationRaw: "Hong Kong" }),
        ),
      ],
      [],
    );
    expect(summary(places)).toEqual([
      { city: "Hong Kong", country: "HK", twin: false, shared: false, n: 6 },
    ]);
  });

  it("falls back to the plurality where nothing is evidenced, and keeps country-less roles", () => {
    const places = cityPlaces(
      [
        ...many(4, { city: "Pangyo", country: "KR", companySlug: "krafton", locationRaw: "Pangyo" }),
        job({ city: "Pangyo", companySlug: "krafton", locationRaw: "Pangyo" }),
        job({ country: "KR", companySlug: "krafton" }), // no city: no city page at all
      ],
      [],
    );
    expect(summary(places)).toEqual([
      { city: "Pangyo", country: "KR", twin: false, shared: false, n: 5 },
    ]);
  });
});
