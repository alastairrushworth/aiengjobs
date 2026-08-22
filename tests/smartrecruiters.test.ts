import { afterEach, describe, expect, it, vi } from "vitest";
import { smartrecruiters } from "../engine/src/connectors/smartrecruiters.ts";
import type { RawPosting } from "../engine/src/connectors/types.ts";

const LIST = "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0";
const DETAIL = "https://api.smartrecruiters.com/v1/companies/acme/postings/42";

/**
 * Record every URL the connector reaches for, and answer the list endpoint with
 * one posting. Anything else gets an empty detail body, so a request that
 * *shouldn't* have happened still shows up in `seen` rather than throwing.
 */
function stubFetch(seen: string[], listBody: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    seen.push(url);
    const body = url.includes("/postings?") ? listBody : { jobAd: { sections: {} } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

async function fetch1(slug: string): Promise<RawPosting[]> {
  const r = await smartrecruiters.fetchPostings(slug);
  return Array.isArray(r) ? r : r.postings;
}

const listing = (ref?: string) => ({
  content: [{ id: "42", name: "AI Engineer", ...(ref ? { ref } : {}) }],
  totalFound: 1,
});

afterEach(() => vi.restoreAllMocks());

/**
 * `ref` arrives in an untrusted payload and used to be handed to fetch verbatim,
 * which made it an outbound-request primitive: whatever it named was fetched,
 * redirects followed, the body parsed as JSON, and its `jobAd` sections
 * published as a job description on a public site.
 */
describe("smartrecruiters detail URL", () => {
  it("refuses a ref pointing anywhere but the SmartRecruiters API", async () => {
    const seen: string[] = [];
    stubFetch(seen, listing("http://169.254.169.254/latest/meta-data/"));

    const postings = await fetch1("acme");

    expect(seen).not.toContain("http://169.254.169.254/latest/meta-data/");
    expect(seen).toContain(DETAIL);
    expect(postings[0]!.title).toBe("AI Engineer");
  });

  it("refuses a look-alike host", async () => {
    const seen: string[] = [];
    stubFetch(seen, listing("https://api.smartrecruiters.com.evil.test/x"));

    await fetch1("acme");

    expect(seen).not.toContain("https://api.smartrecruiters.com.evil.test/x");
    expect(seen).toContain(DETAIL);
  });

  it("uses the ref when it really is the API", async () => {
    const seen: string[] = [];
    const ref = `${DETAIL}?extra=1`;
    stubFetch(seen, listing(ref));

    await fetch1("acme");

    expect(seen).toContain(ref);
  });

  it("falls back cleanly when the feed supplies no ref at all", async () => {
    const seen: string[] = [];
    stubFetch(seen, listing());

    await fetch1("acme");

    expect(seen).toEqual([LIST, DETAIL]);
  });
});
