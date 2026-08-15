import { describe, expect, it } from "vitest";
import type { Job } from "../shared/types.ts";
import { buildJobTitles } from "../site/src/lib/jobTitle.ts";

let n = 0;
function job(partial: Partial<Job> & Pick<Job, "title" | "companyName">): Job {
  return {
    slug: partial.slug ?? `slug-${++n}`,
    companySlug: partial.companySlug ?? partial.companyName.toLowerCase(),
    normalizedTitle: partial.title,
    applyUrl: "https://example.com/apply",
    skills: [],
    clusters: [],
    ...partial,
  } as Job;
}

const titleOf = (jobs: Job[], slug: string) => buildJobTitles(jobs).get(slug)!;

describe("buildJobTitles", () => {
  it("leaves a short title alone", () => {
    const j = job({ slug: "a", title: "LLM Engineer", companyName: "Acme" });
    expect(titleOf([j], "a")).toBe("LLM Engineer · Acme");
  });

  it("trims an over-long title but keeps the company whole", () => {
    const j = job({
      slug: "a",
      title:
        "Principal AI/ML Researcher In Bayesian, Large Foundational Systems, and Distributional Reinforcement Learning",
      companyName: "Acme",
    });
    const t = titleOf([j], "a");
    expect(t.length).toBeLessThanOrEqual(52);
    expect(t).toMatch(/…\s·\sAcme$/);
  });

  it("does not merge two distinct roles that share a long prefix", () => {
    const jobs = [
      job({
        slug: "a",
        title: "Staff Robotics Software Engineer, Air Vehicle Autonomy Systems",
        companyName: "Anduril",
      }),
      job({
        slug: "b",
        title: "Staff Robotics Software Engineer, Air Vehicle Perception Systems",
        companyName: "Anduril",
      }),
    ];
    expect(titleOf(jobs, "a")).not.toBe(titleOf(jobs, "b"));
  });

  it("grants only as much extra room as disambiguation needs", () => {
    // Shared prefix runs past the base budget, so the first render collides;
    // the titles diverge soon after, so one step of extra room separates them
    // without needing the full (much longer) title.
    const shared = "Founding Research Engineer in the Frontier Model Team, ";
    const tail = "and Global and more padding to push this well past the budget";
    const jobs = [
      job({ slug: "a", title: `${shared}UK and Germany ${tail}`, companyName: "Flower" }),
      job({ slug: "b", title: `${shared}Germany and UK ${tail}`, companyName: "Flower" }),
    ];
    const a = titleOf(jobs, "a");
    expect(a).not.toBe(titleOf(jobs, "b"));
    expect(a).toContain("…");
    // Disambiguated without falling all the way back to the untrimmed title.
    expect(a.length).toBeLessThan(`${shared}UK and Germany ${tail} · Flower`.length);
  });

  it("appends the city when one role posts at several sites", () => {
    const jobs = [
      job({ slug: "a", title: "ML Engineer", companyName: "Faculty", city: "London" }),
      job({ slug: "b", title: "ML Engineer", companyName: "Faculty", city: "Leeds" }),
    ];
    expect(titleOf(jobs, "a")).toBe("ML Engineer · Faculty · London");
    expect(titleOf(jobs, "b")).toBe("ML Engineer · Faculty · Leeds");
  });

  it("leaves genuine duplicate requisitions sharing a title", () => {
    // Same role, same site, several reqs — data.ts canonicalizes these onto one
    // page, so there is nothing to disambiguate with.
    const jobs = [
      job({ slug: "a", title: "Forward Deployed Engineer", companyName: "Workato", city: "Hyderabad" }),
      job({ slug: "b", title: "Forward Deployed Engineer", companyName: "Workato", city: "Hyderabad" }),
    ];
    expect(titleOf(jobs, "a")).toBe(titleOf(jobs, "b"));
  });

  it("bounds the title even when the collision loop gives up", () => {
    // The unlimited allowance is the escape hatch for roles that still collide
    // at full length. It used to mean "render all 163 characters of the feed
    // title", which produced a 203-character <title>.
    const monster =
      "Research Lead / Principal Scientist & Manager Post-Training · Alignment · " +
      "Reinforcement Learning Autodesk AI Lab: London · San Francisco · Toronto · Remote (US/CA/EU) -";
    const jobs = [
      job({ slug: "a", title: monster, companyName: "Autodesk" }),
      job({ slug: "b", title: `${monster} II`, companyName: "Autodesk" }),
    ];
    for (const slug of ["a", "b"]) {
      expect(titleOf(jobs, slug).length).toBeLessThanOrEqual(110);
    }
  });

  it("bounds the location half of the suffix", () => {
    // locationRaw is the last-resort disambiguator and arrives unbounded; this
    // one is 40 characters and pushed the rendered title to 129.
    const jobs = [
      job({
        slug: "a",
        title: "Staff Machine Learning Engineer, Agentic App Platform",
        companyName: "ServiceNow",
        city: "Mountain View",
        locationRaw: "Mountain View, CALIFORNIA, United States",
      }),
      job({
        slug: "b",
        title: "Staff Machine Learning Engineer, Agentic App Platform",
        companyName: "ServiceNow",
        city: "Mountain View",
        locationRaw: "Mountain View, CALIFORNIA, United States (Remote)",
      }),
    ];
    expect(titleOf(jobs, "a").length).toBeLessThanOrEqual(110);
  });

  it("keeps a short place whole rather than trimming to the ceiling", () => {
    const jobs = [
      job({ slug: "a", title: "ML Engineer", companyName: "Faculty", city: "London" }),
      job({ slug: "b", title: "ML Engineer", companyName: "Faculty", city: "Leeds" }),
    ];
    expect(titleOf(jobs, "a")).toBe("ML Engineer · Faculty · London");
  });

  it("terminates when a truncation can never disambiguate", () => {
    const jobs = Array.from({ length: 3 }, (_, i) =>
      job({ slug: `s${i}`, title: "A".repeat(300), companyName: "Acme" }),
    );
    expect(() => buildJobTitles(jobs)).not.toThrow();
    expect(buildJobTitles(jobs).size).toBe(3);
  });
});

describe("collisions the city cannot separate", () => {
  it("falls through to the country when two postings share a placeholder city", () => {
    // Both Coalition postings carry city "Any location" — one US, one Canada —
    // so short-circuiting on the city rendered an identical <title> and meta
    // description for two indexable pages.
    const jobs = [
      job({
        slug: "coalition-senior-software-engineer-594ea7",
        title: "Senior Software Engineer",
        companyName: "Coalition",
        city: "Any location",
        country: "US",
        locationRaw: "Any location, United States",
      }),
      job({
        slug: "coalition-senior-software-engineer-15c976",
        title: "Senior Software Engineer",
        companyName: "Coalition",
        city: "Any location",
        country: "CA",
        locationRaw: "Any location, Canada",
      }),
    ];
    const titles = buildJobTitles(jobs);
    const a = titles.get("coalition-senior-software-engineer-594ea7")!;
    const b = titles.get("coalition-senior-software-engineer-15c976")!;
    expect(a).not.toBe(b);
  });

  it("still prefers the bare city when that is enough to tell them apart", () => {
    const jobs = [
      job({ slug: "a", title: "AI Engineer", companyName: "Acme", city: "London", country: "GB" }),
      job({ slug: "b", title: "AI Engineer", companyName: "Acme", city: "Berlin", country: "DE" }),
    ];
    const titles = buildJobTitles(jobs);
    expect(titles.get("a")).toContain("London");
    expect(titles.get("a")).not.toContain("United Kingdom");
  });
});
