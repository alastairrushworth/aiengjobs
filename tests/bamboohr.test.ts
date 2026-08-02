import { afterEach, describe, expect, it, vi } from "vitest";
import { bamboohr } from "../engine/src/connectors/bamboohr.ts";
import type { RawPosting } from "../engine/src/connectors/types.ts";

/** fetchPostings may return the capped {postings} form; bamboohr never does. */
async function fetch1(slug: string): Promise<RawPosting[]> {
  const r = await bamboohr.fetchPostings(slug);
  return Array.isArray(r) ? r : r.postings;
}

const listJob = (over: Record<string, unknown> = {}) => ({
  id: "142",
  jobOpeningName: "Senior ML Engineer",
  employmentStatusLabel: "Full-Time",
  location: { city: "Edinburgh", state: "Midlothian" },
  atsLocation: { country: null, state: null, province: null, city: null },
  isRemote: null,
  locationType: "0",
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  meta: {},
  result: {
    jobOpening: {
      jobOpeningName: "Senior ML Engineer",
      jobOpeningStatus: "Open",
      jobOpeningShareUrl: "https://acme.bamboohr.com/careers/142",
      description: "<p>Build <b>models</b>.</p>",
      compensation: "£70,000 - £90,000",
      datePosted: "2026-04-27",
      locationType: "0",
      employmentStatusLabel: "Full-Time",
      ...over,
    },
  },
});

/** Stub fetch with a router keyed on URL substring. */
function stubFetch(routes: Array<[string, { status?: number; body?: unknown }]>) {
  const spy = vi.spyOn(globalThis, "fetch");
  spy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([frag]) => url.includes(frag));
    const { status = 200, body = {} } = hit?.[1] ?? { status: 404 };
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe("bamboohr connector", () => {
  it("maps a posting from the list + detail pair", async () => {
    stubFetch([
      ["/careers/list", { body: { meta: { totalCount: 1 }, result: [listJob()] } }],
      ["/careers/142/detail", { body: detail() }],
    ]);

    const [p] = await fetch1("acme");
    expect(p.externalId).toBe("142");
    expect(p.title).toBe("Senior ML Engineer");
    expect(p.applyUrl).toBe("https://acme.bamboohr.com/careers/142");
    expect(p.descriptionText).toContain("Build models");
    expect(p.locationRaw).toBe("Edinburgh, Midlothian");
    expect(p.remoteType).toBe("onsite");
    expect(p.postedAt).toBe("2026-04-27T00:00:00.000Z");
    expect(p.salaryMin).toBe(70000);
    expect(p.salaryMax).toBe(90000);
    expect(p.salaryCurrency).toBe("GBP");
  });

  it("throws rather than reporting an empty board when the tenant is unknown", async () => {
    // BambooHR 302s an unknown subdomain to its marketing site. Parsing that as
    // an empty board would expire every one of the company's live jobs.
    stubFetch([["/careers/list", { status: 302 }]]);
    await expect(fetch1("nope")).rejects.toThrow(/unknown tenant/);
  });

  it("throws on a non-OK list response", async () => {
    stubFetch([["/careers/list", { status: 500 }]]);
    await expect(fetch1("acme")).rejects.toThrow(/HTTP 500/);
  });

  it("reads the remote region from atsLocation when there is no office", async () => {
    stubFetch([
      [
        "/careers/list",
        {
          body: {
            result: [
              listJob({
                locationType: "1",
                location: { city: null, state: null },
                atsLocation: { country: "Ireland", state: null, province: null, city: "Remote in Ireland" },
              }),
            ],
          },
        },
      ],
      ["/careers/142/detail", { body: detail({ locationType: "1" }) }],
    ]);

    const [p] = await fetch1("acme");
    expect(p.locationRaw).toBe("Remote in Ireland, Ireland");
    expect(p.remoteType).toBe("remote");
  });

  it("marks locationType 2 as hybrid", async () => {
    stubFetch([
      ["/careers/list", { body: { result: [listJob({ locationType: "2" })] } }],
      ["/careers/142/detail", { body: detail({ locationType: "2" }) }],
    ]);
    const [p] = await fetch1("acme");
    expect(p.remoteType).toBe("hybrid");
  });

  it("drops a posting the detail says is no longer open", async () => {
    stubFetch([
      ["/careers/list", { body: { result: [listJob()] } }],
      ["/careers/142/detail", { body: detail({ jobOpeningStatus: "Filled" }) }],
    ]);
    expect(await fetch1("acme")).toEqual([]);
  });

  it("keeps the posting when its detail fetch fails", async () => {
    // The list only carries open roles, so a failed detail must not lose one.
    stubFetch([["/careers/list", { body: { result: [listJob()] } }]]);
    const [p] = await fetch1("acme");
    expect(p.title).toBe("Senior ML Engineer");
    expect(p.applyUrl).toBe("https://acme.bamboohr.com/careers/142");
    expect(p.descriptionText).toBeUndefined();
  });

  it("does not emit Invalid Date for an unparseable datePosted", async () => {
    stubFetch([
      ["/careers/list", { body: { result: [listJob()] } }],
      ["/careers/142/detail", { body: detail({ datePosted: "not-a-date" }) }],
    ]);
    const [p] = await fetch1("acme");
    expect(p.postedAt).toBeUndefined();
  });

  it("leaves pay unset when compensation is not a number", async () => {
    stubFetch([
      ["/careers/list", { body: { result: [listJob()] } }],
      ["/careers/142/detail", { body: detail({ compensation: "Competitive" }) }],
    ]);
    const [p] = await fetch1("acme");
    expect(p.salaryMin).toBeUndefined();
    expect(p.salaryMax).toBeUndefined();
  });

  it("skips rows with no id or title", async () => {
    stubFetch([
      [
        "/careers/list",
        { body: { result: [{ id: null, jobOpeningName: "X" }, { id: "9" }] } },
      ],
    ]);
    expect(await fetch1("acme")).toEqual([]);
  });

  it("builds the documented endpoint", () => {
    expect(bamboohr.endpoint("acme")).toBe("https://acme.bamboohr.com/careers/list");
  });
});
