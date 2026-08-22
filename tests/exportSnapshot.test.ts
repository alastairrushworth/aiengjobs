import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SiteSnapshot } from "@aiengjobs/shared";
import { orderedPay } from "../engine/src/export/exportSnapshot.ts";

describe("orderedPay", () => {
  it("passes a well-ordered range through unchanged", () => {
    expect(orderedPay(120_000, 180_000)).toEqual({
      salaryMin: 120_000,
      salaryMax: 180_000,
    });
  });

  it("swaps a reversed range rather than dropping it", () => {
    // adobe-wd5-external-experienced-machine-learning-engineer-b5a53e carries
    // min 161700 / max 23415, which rendered as "$162k–$23k/yr" and emitted an
    // invalid MonetaryAmount in the JobPosting JSON-LD.
    expect(orderedPay(161_700, 23_415)).toEqual({
      salaryMin: 23_415,
      salaryMax: 161_700,
    });
  });

  it("collapses equal bounds to a single figure", () => {
    expect(orderedPay(150_000, 150_000)).toEqual({ salaryMin: 150_000 });
  });

  it("keeps a lone figure as a minimum", () => {
    expect(orderedPay(150_000, null)).toEqual({
      salaryMin: 150_000,
      salaryMax: undefined,
    });
  });

  it("emits nothing when there is no pay at all", () => {
    expect(orderedPay(null, null)).toEqual({
      salaryMin: undefined,
      salaryMax: undefined,
    });
  });
});

/**
 * The engine↔site contract, exercised end to end: a database in, the file the
 * Astro build reads out. `orderedPay` above is the only part of this module
 * that was covered, and it is the part least likely to break — the rows that
 * reach the snapshot, and the fields they carry, is the surface that actually
 * decides what the public board shows.
 */
describe("exportSnapshot", () => {
  const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");
  const dirs: string[] = [];

  interface JobSeed {
    id: string;
    company: string;
    classification?: string;
    isClosed?: number;
    lastSeenAt?: string;
    salaryMin?: number | null;
    salaryMax?: number | null;
    city?: string | null;
    descriptionHtml?: string | null;
  }

  function build(companies: string[], jobs: JobSeed[]): string {
    const dir = mkdtempSync(join(tmpdir(), "export-"));
    dirs.push(dir);
    const path = join(dir, "test.db");
    const db = new DatabaseSync(path);
    db.exec(SCHEMA);
    for (const c of companies) {
      db.prepare(
        `INSERT INTO companies (id, name, slug, domain, ats_provider, ats_token)
         VALUES (?, ?, ?, ?, 'greenhouse', ?)`,
      ).run(`co_${c}`, c.toUpperCase(), c, `${c}.test`, `secret-token-${c}`);
    }
    for (const j of jobs) {
      db.prepare(
        `INSERT INTO jobs (id, company_id, slug, title, normalized_title, apply_url,
                           description_html, city, salary_min, salary_max, salary_currency,
                           classification, is_closed, last_seen_at, ingested_at, content_hash)
         VALUES (?, ?, ?, 'AI Engineer', 'ai engineer', 'https://x/apply', ?, ?, ?, ?, 'USD',
                 ?, ?, ?, '2026-08-01T00:00:00Z', 'h')`,
      ).run(
        j.id,
        `co_${j.company}`,
        j.id,
        j.descriptionHtml ?? "<p>Build <b>things</b>.</p><ul><li>RAG</li></ul>",
        j.city ?? null,
        j.salaryMin ?? null,
        j.salaryMax ?? null,
        j.classification ?? "in",
        j.isClosed ?? 0,
        j.lastSeenAt ?? "2026-08-20T00:00:00Z",
      );
    }
    db.close();
    return dir;
  }

  /** Run the exporter against `dir` and read back what it wrote. */
  async function runExport(dir: string): Promise<SiteSnapshot> {
    process.env.AIENGJOBS_DB = join(dir, "test.db");
    process.env.SNAPSHOT_OUT = join(dir, "snapshot.json");
    process.env.SNAPSHOT_META_OUT = join(dir, "meta.json");
    // fetchFxRates falls back to the static table when the feed answers badly,
    // which is what keeps this test off the network. A non-ok response rather
    // than a rejection: fetchRetry retries a thrown error three times with
    // backoff, and paying that in every case here cost 13 seconds.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 503 }),
    );
    vi.resetModules();
    const { exportSnapshot } = await import("../engine/src/export/exportSnapshot.ts");
    await exportSnapshot();
    return JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")) as SiteSnapshot;
  }

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env.AIENGJOBS_DB;
    delete process.env.SNAPSHOT_OUT;
    delete process.env.SNAPSHOT_META_OUT;
    vi.restoreAllMocks();
  });

  it("publishes only companies with a role on the board", async () => {
    // The seed list is roughly twice the size of the board: 1,395 companies
    // shipped against 699 any job referenced.
    const dir = build(
      ["listed", "rejected", "never-polled"],
      [
        { id: "a", company: "listed" },
        { id: "b", company: "rejected", classification: "out" },
      ],
    );

    const snap = await runExport(dir);

    expect(snap.companies.map((c) => c.slug)).toEqual(["listed"]);
  });

  it("keeps internal provenance out of the published file", async () => {
    const dir = build(["listed"], [{ id: "a", company: "listed" }]);

    const snap = await runExport(dir);
    const raw = readFileSync(join(dir, "snapshot.json"), "utf8");

    expect(snap.companies[0]).not.toHaveProperty("atsToken");
    expect(snap.companies[0]).not.toHaveProperty("atsProvider");
    expect(raw).not.toContain("secret-token");
  });

  it("exports in-scope roles and drops the rest", async () => {
    const dir = build(
      ["co"],
      [
        { id: "in", company: "co" },
        { id: "out", company: "co", classification: "out" },
      ],
    );

    const snap = await runExport(dir);

    expect(snap.jobs.map((j) => j.slug)).toEqual(["in"]);
  });

  it("keeps a recently-closed role as a tombstone, without its description", async () => {
    const dir = build(
      ["co"],
      [{ id: "gone", company: "co", isClosed: 1, lastSeenAt: "2026-08-20T00:00:00Z" }],
    );

    const snap = await runExport(dir);

    expect(snap.jobs[0]).toMatchObject({ slug: "gone", isClosed: true });
    expect(snap.jobs[0]!.descriptionText).toBeUndefined();
  });

  it("drops a role that closed longer ago than the retention window", async () => {
    const dir = build(
      ["co"],
      [{ id: "ancient", company: "co", isClosed: 1, lastSeenAt: "2020-01-01T00:00:00Z" }],
    );

    const snap = await runExport(dir);

    expect(snap.jobs).toEqual([]);
    expect(snap.companies).toEqual([]);
  });

  it("re-derives display text from the stored HTML, keeping list structure", async () => {
    const dir = build(["co"], [{ id: "a", company: "co" }]);

    const snap = await runExport(dir);

    expect(snap.jobs[0]!.descriptionText).toContain("Build things.");
    expect(snap.jobs[0]!.descriptionText).toContain("• RAG");
  });

  it("orders a reversed pay range on the way out", async () => {
    // Rows like this predate the current parser and nothing re-derives them, so
    // the exporter is the one place every consumer goes through.
    const dir = build(["co"], [{ id: "a", company: "co", salaryMin: 161_700, salaryMax: 23_415 }]);

    const snap = await runExport(dir);

    expect(snap.jobs[0]).toMatchObject({ salaryMin: 23_415, salaryMax: 161_700 });
  });

  it("re-canonicalizes a city written by an older engine", async () => {
    // "Cn", "Va" and "Ontario" were all live addressLocality values.
    const dir = build(
      ["co"],
      [
        { id: "code", company: "co", city: "Cn" },
        { id: "prov", company: "co", city: "Ontario" },
        { id: "real", company: "co", city: "berlin" },
      ],
    );

    const snap = await runExport(dir);
    const cityOf = (slug: string) => snap.jobs.find((j) => j.slug === slug)?.city;

    expect(cityOf("code")).toBeUndefined();
    expect(cityOf("prov")).toBeUndefined();
    expect(cityOf("real")).toBe("Berlin");
  });

  it("writes a meta file whose counts match the snapshot", async () => {
    const dir = build(
      ["co"],
      [
        { id: "open", company: "co" },
        { id: "shut", company: "co", isClosed: 1 },
      ],
    );

    const snap = await runExport(dir);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));

    expect(meta).toEqual({
      generatedAt: snap.generatedAt,
      openJobs: 1,
      closedJobs: 1,
      companies: 1,
    });
  });
});
