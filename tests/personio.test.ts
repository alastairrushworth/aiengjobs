import { afterEach, describe, expect, it, vi } from "vitest";
import { personio } from "../engine/src/connectors/personio.ts";
import type { RawPosting } from "../engine/src/connectors/types.ts";

async function fetch1(slug: string): Promise<RawPosting[]> {
  const r = await personio.fetchPostings(slug);
  return Array.isArray(r) ? r : r.postings;
}

const position = (over: { extra?: string; descriptions?: string; title?: string } = {}) => `
<position>
    <id>2727770</id>
    <office>Edinburgh</office>
    <department>Engineering</department>
    <name>${over.title ?? "Senior ML Engineer"}</name>
    <jobDescriptions>${
      over.descriptions ??
      `
        <jobDescription>
            <name>About the role</name>
            <value><![CDATA[<p>Build <b>models</b>.</p>]]></value>
        </jobDescription>`
    }
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <schedule>full-time</schedule>
    <createdAt>2026-07-24T12:35:26+00:00</createdAt>
    ${over.extra ?? ""}
</position>`;

const feed = (...blocks: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<workzag-jobs>${blocks.join("\n")}</workzag-jobs>`;

/** Stub fetch per host: "com" / "de" -> {status, body}. */
function stubFetch(byHost: Record<string, { status?: number; body?: string }>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const key = url.includes("personio.com") ? "com" : "de";
    const { status = 200, body = "" } = byHost[key] ?? { status: 307 };
    return new Response(status === 307 ? null : body, {
      status,
      headers: { "content-type": "application/xml" },
    });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("personio connector", () => {
  it("maps a position from the XML feed", async () => {
    stubFetch({ com: { body: feed(position()) } });
    const [p] = await fetch1("acme");
    expect(p.externalId).toBe("2727770");
    expect(p.title).toBe("Senior ML Engineer");
    expect(p.applyUrl).toBe("https://acme.jobs.personio.com/job/2727770");
    expect(p.locationRaw).toBe("Edinburgh");
    expect(p.employmentType).toBe("full-time");
    expect(p.postedAt).toBe("2026-07-24T12:35:26+00:00");
    expect(p.descriptionText).toContain("Build models");
  });

  it("does not let a description heading shadow the job title", async () => {
    // Every <jobDescription> carries its own <name>. Reading flat fields before
    // stripping the block returns "About the role" as the title on every job.
    stubFetch({ com: { body: feed(position()) } });
    const [p] = await fetch1("acme");
    expect(p.title).toBe("Senior ML Engineer");
    expect(p.title).not.toBe("About the role");
  });

  it("keeps each description section as a heading", async () => {
    stubFetch({
      com: {
        body: feed(
          position({
            descriptions: `
        <jobDescription>
            <name>About the role</name>
            <value><![CDATA[<p>One.</p>]]></value>
        </jobDescription>
        <jobDescription>
            <name>Requirements</name>
            <value><![CDATA[<p>Two.</p>]]></value>
        </jobDescription>`,
          }),
        ),
      },
    });
    const [p] = await fetch1("acme");
    expect(p.descriptionHtml).toContain("<h3>About the role</h3>");
    expect(p.descriptionHtml).toContain("<h3>Requirements</h3>");
    expect(p.descriptionText).toContain("One.");
    expect(p.descriptionText).toContain("Two.");
  });

  it("decodes XML entities in flat fields", async () => {
    stubFetch({ com: { body: feed(position({ title: "R&amp;D Engineer" })) } });
    const [p] = await fetch1("acme");
    expect(p.title).toBe("R&D Engineer");
  });

  it("reads structured pay and maps the cadence", async () => {
    stubFetch({
      com: {
        body: feed(
          position({
            extra: `<salaryInformation><min>29000.00</min><max>41000.00</max><currencyCode>GBP</currencyCode><type>yearly</type></salaryInformation>`,
          }),
        ),
      },
    });
    const [p] = await fetch1("acme");
    expect(p.salaryMin).toBe(29000);
    expect(p.salaryMax).toBe(41000);
    expect(p.salaryCurrency).toBe("GBP");
    expect(p.salaryPeriod).toBe("year");
  });

  it("drops pay with no currency rather than guessing", async () => {
    stubFetch({
      com: {
        body: feed(
          position({ extra: `<salaryInformation><min>29000</min><type>yearly</type></salaryInformation>` }),
        ),
      },
    });
    const [p] = await fetch1("acme");
    expect(p.salaryMin).toBeUndefined();
    expect(p.salaryCurrency).toBeUndefined();
  });

  it("drops weekly pay, which has no SalaryPeriod to map onto", async () => {
    stubFetch({
      com: {
        body: feed(
          position({
            extra: `<salaryInformation><min>800</min><currencyCode>GBP</currencyCode><type>weekly</type></salaryInformation>`,
          }),
        ),
      },
    });
    const [p] = await fetch1("acme");
    expect(p.salaryMin).toBeUndefined();
    expect(p.salaryPeriod).toBeUndefined();
  });

  it("infers remote and hybrid from the office label", async () => {
    stubFetch({ com: { body: feed(position().replace("<office>Edinburgh</office>", "<office>Remote - UK</office>")) } });
    expect((await fetch1("acme"))[0].remoteType).toBe("remote");

    vi.restoreAllMocks();
    stubFetch({ com: { body: feed(position().replace("<office>Edinburgh</office>", "<office>London (Hybrid)</office>")) } });
    expect((await fetch1("acme"))[0].remoteType).toBe("hybrid");
  });

  it("falls back to the .de host when .com has no board", async () => {
    stubFetch({ com: { status: 307 }, de: { body: feed(position()) } });
    const [p] = await fetch1("acme");
    expect(p.title).toBe("Senior ML Engineer");
  });

  it("throws rather than reporting an empty board when the tenant is unknown", async () => {
    // Personio 307s an unknown tenant to its marketing site. Parsing that as a
    // board with no positions would expire every one of the company's jobs.
    stubFetch({ com: { status: 307 }, de: { status: 307 } });
    await expect(fetch1("nope")).rejects.toThrow(/no board on either host/);
  });

  it("throws on a non-OK response", async () => {
    stubFetch({ com: { status: 500, body: "" } });
    await expect(fetch1("acme")).rejects.toThrow(/HTTP 500/);
  });

  it("returns an empty board without error when the feed has no positions", async () => {
    stubFetch({ com: { body: feed() } });
    expect(await fetch1("acme")).toEqual([]);
  });

  it("skips a position with no id or title", async () => {
    stubFetch({ com: { body: feed("<position><office>Edinburgh</office></position>") } });
    expect(await fetch1("acme")).toEqual([]);
  });

  it("builds the documented endpoint", () => {
    expect(personio.endpoint("acme")).toBe("https://acme.jobs.personio.com/xml");
  });
});
