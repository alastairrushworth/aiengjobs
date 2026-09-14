import { afterEach, describe, expect, it, vi } from "vitest";
import { workable } from "../engine/src/connectors/workable.ts";
import type { RawPosting } from "../engine/src/connectors/types.ts";

async function fetch1(slug: string): Promise<RawPosting[]> {
  const r = await workable.fetchPostings(slug);
  return Array.isArray(r) ? r : r.postings;
}

const row = (shortcode: string, city: string) => ({
  shortcode,
  title: `Inspector ${shortcode}`,
  application_url: `https://apply.workable.com/j/${shortcode}/apply`,
  city,
  country: "France",
});

function stub(rows: unknown[], detail: (code: string) => unknown | "hang" | "throttle" | "gone") {
  const detailCalls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("/api/accounts/")) return Response.json({ jobs: rows });
    const code = url.slice(url.lastIndexOf("/") + 1);
    detailCalls.push(code);
    const d = detail(code);
    if (d === "hang") throw new Error("fetch timed out");
    if (d === "throttle") return new Response("slow down", { status: 429 });
    if (d === "gone") return new Response("not found", { status: 404 });
    return Response.json(d);
  });
  return detailCalls;
}

afterEach(() => vi.restoreAllMocks());

describe("workable connector", () => {
  it("fetches a multi-location job once, not once per location row", async () => {
    // Workable lists one row per location; Intertek's 250 rows were 149 jobs.
    const calls = stub(
      [row("A1", "Paris"), row("A1", "Dijon"), row("A1", "Belfort"), row("B2", "Lyon")],
      () => ({ description: "<p>Inspect.</p>", location: { city: "Paris", country: "France" } }),
    );
    const out = await fetch1("intertek");
    expect(out.map((p) => p.externalId)).toEqual(["A1", "B2"]);
    expect(calls).toEqual(["A1", "B2"]);
    expect(out[0].locationRaw).toBe("Paris, France");
  });

  it("fails the feed instead of publishing a title-only board when detail is unreachable", async () => {
    const rows = Array.from({ length: 55 }, (_, i) => row(`C${i}`, "Cambridge"));
    const calls = stub(rows, () => "hang");
    await expect(workable.fetchPostings("luminance-1")).rejects.toThrow(
      /workable luminance-1: detail fetches failing/,
    );
    // Eight postings at most (five failures to trip, three more in flight),
    // each retried three times — not 55 × 3 timeouts.
    expect(calls.length).toBeLessThanOrEqual(8 * 3);
  });

  it("treats a 429 that outlasts the retries as a failure too", async () => {
    // fetchRetry hands back the final 429 rather than throwing; on 2026-09-14
    // that is what 14 minutes of Intertek detail fetches looked like.
    const rows = Array.from({ length: 149 }, (_, i) => row(`D${i}`, "Paris"));
    const calls = stub(rows, () => "throttle");
    await expect(workable.fetchPostings("intertek")).rejects.toThrow(
      /workable intertek: detail fetches failing/,
    );
    expect(calls.length).toBeLessThanOrEqual(8 * 3);
  });

  it("keeps a posting whose one detail fetch 404s, as a list-only row", async () => {
    stub([row("A1", "Paris"), row("B2", "Lyon")], (code) =>
      code === "B2" ? "gone" : { description: "<p>Inspect.</p>" },
    );
    const out = await fetch1("acme");
    expect(out).toHaveLength(2);
    expect(out[0].descriptionText).toBe("Inspect.");
    expect(out[1]).toMatchObject({ externalId: "B2", descriptionText: undefined });
  });
});
