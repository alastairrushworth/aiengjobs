import { afterEach, describe, expect, it, vi } from "vitest";
import { workday } from "../engine/src/connectors/workday.ts";
import type { PostingsResult } from "../engine/src/connectors/types.ts";

const SLUG = "acme:wd5:Careers";

const listRow = (n: number) => ({
  title: `Machine Learning Engineer ${n}`,
  externalPath: `/job/Remote/ML-Engineer-${n}_R${n}`,
  locationsText: "Remote",
  bulletFields: [`R${n}`],
});

/** A Workday tenant with `total` matching roles for every query, served 20 a
 *  page, and a detail endpoint that answers per `detail`. */
function stubTenant(
  total: number,
  detail: (path: string) => { status?: number; body?: unknown } | "hang",
) {
  const detailCalls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/jobs") && init?.method === "POST") {
        const { offset } = JSON.parse(String(init.body)) as { offset: number };
        const jobPostings = Array.from({ length: Math.min(20, Math.max(0, total - offset)) }, (_, i) =>
          listRow(offset + i + 1),
        );
        return Response.json({ total, jobPostings });
      }
      const path = url.slice(url.indexOf("/job/"));
      detailCalls.push(path);
      const d = detail(path);
      if (d === "hang") throw new Error("fetch timed out");
      return new Response(JSON.stringify(d.body ?? {}), {
        status: d.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return detailCalls;
}

const info = (path: string) => ({
  body: {
    jobPostingInfo: {
      title: `Detailed ${path}`,
      jobDescription: "<p>Build models.</p>",
      externalUrl: `https://acme.wd5.myworkdayjobs.com/Careers${path}`,
      startDate: "2026-09-01",
    },
  },
});

afterEach(() => vi.restoreAllMocks());

describe("workday connector", () => {
  it("fetches detail for every row when the board fits under the cap", async () => {
    const calls = stubTenant(12, info);
    const r = (await workday.fetchPostings(SLUG)) as PostingsResult;
    expect(r.postings).toHaveLength(12);
    expect(r.seen).toEqual([]);
    expect(r.partial).toBe(false);
    expect(calls).toHaveLength(12);
    expect(r.postings[0]).toMatchObject({
      externalId: "R1",
      title: "Detailed /job/Remote/ML-Engineer-1_R1",
      descriptionText: "Build models.",
    });
  });

  it("past the cap: fetches unknown roles, marks the stored ones seen, still polled", async () => {
    // 160 matches, of which the database already holds all but four.
    const calls = stubTenant(160, info);
    const fresh = new Set(["R3", "R70", "R120", "R160"]);
    const r = (await workday.fetchPostings(SLUG, {
      isKnown: (id) => !fresh.has(id),
    })) as PostingsResult;
    expect(r.postings).toHaveLength(50);
    expect(calls).toHaveLength(50);
    // The four new roles are fetched tonight, whatever their rank.
    const fetchedIds = new Set(r.postings.map((p) => p.externalId));
    for (const id of fresh) expect(fetchedIds.has(id)).toBe(true);
    // Everything else is reported as seen, so ingest keeps it open without a
    // re-read — and the listing was complete, so closures can run.
    expect(r.seen).toHaveLength(110);
    expect(new Set([...r.seen!, ...fetchedIds]).size).toBe(160);
    expect(r.partial).toBe(false);
  });

  it("reports the listing partial when a query has more hits than it pages", async () => {
    stubTenant(444, info);
    const r = (await workday.fetchPostings(SLUG, { isKnown: () => true })) as PostingsResult;
    expect(r.partial).toBe(true);
    // 400 rows paged: 50 fetched, 350 seen.
    expect(r.postings).toHaveLength(50);
    expect(r.seen).toHaveLength(350);
  });

  it("degrades one failed detail to its list row", async () => {
    stubTenant(6, (path) => (path.includes("_R4") ? "hang" : info(path)));
    const r = (await workday.fetchPostings(SLUG)) as PostingsResult;
    expect(r.postings).toHaveLength(6);
    expect(r.postings[3]).toMatchObject({
      externalId: "R4",
      title: "Machine Learning Engineer 4",
      descriptionText: undefined,
    });
  });

  it("fails the feed when detail fetches are failing across the board", async () => {
    const calls = stubTenant(40, () => "hang");
    await expect(workday.fetchPostings(SLUG)).rejects.toThrow(
      /workday acme: detail fetches failing/,
    );
    // Each posting costs fetchRetry's three attempts. The breaker trips on the
    // fifth failure with at most three more in flight, so eight postings at
    // the outside — not the forty the old connector waited on.
    expect(calls.length).toBeLessThanOrEqual(8 * 3);
  });
});
