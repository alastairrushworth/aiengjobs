import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLUSTERS } from "@aiengjobs/shared/taxonomy";
import { slugify } from "../engine/src/util/id.ts";

const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");

const dirs: string[] = [];

interface Row {
  id: string;
  title: string;
  text?: string | null;
  conf?: number;
  country?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  classification?: string;
}

/** A throwaway on-disk database — retag opens it through AIENGJOBS_DB. */
function makeDb(rows: Row[]): string {
  const dir = mkdtempSync(join(tmpdir(), "retag-"));
  dirs.push(dir);
  const path = join(dir, "test.db");
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // job_skills has a FK onto skills, which initDb seeds from the taxonomy.
  const skill = db.prepare("INSERT OR IGNORE INTO skills (id, name, cluster) VALUES (?, ?, ?)");
  for (const c of CLUSTERS) for (const n of c.skills) skill.run(`sk_${slugify(n)}`, n, c.id);
  db.prepare(
    "INSERT INTO companies (id, name, slug, ats_provider) VALUES ('co', 'Co', 'co', 'greenhouse')",
  ).run();
  db.prepare(
    "INSERT INTO sources (id, company_id, ats_provider, endpoint_url) VALUES ('src', 'co', 'greenhouse', 'https://x')",
  ).run();
  for (const r of rows) {
    db.prepare(
      `INSERT INTO jobs (id, company_id, source_id, slug, title, normalized_title, apply_url,
                         description_text, classification, classification_confidence, country,
                         salary_min, salary_max, salary_currency, is_direct, is_closed, last_seen_at)
       VALUES (?, 'co', 'src', ?, ?, ?, 'https://x/apply', ?, ?, ?, ?, ?, ?, ?, 0, 0, '2026-08-01T00:00:00Z')`,
    ).run(
      r.id,
      r.id,
      r.title,
      r.title.toLowerCase(),
      r.text ?? null,
      r.classification ?? "in",
      r.conf ?? 0.95,
      r.country ?? null,
      r.salaryMin ?? null,
      r.salaryMax ?? null,
      r.salaryCurrency ?? null,
    );
  }
  db.close();
  return path;
}

function readJobs(path: string): Record<
  string,
  { classification: string; currency: string | null; min: number | null; max: number | null }
> {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, classification, salary_currency AS currency,
              salary_min AS min, salary_max AS max FROM jobs ORDER BY id`,
    )
    .all() as unknown as {
    id: string;
    classification: string;
    currency: string | null;
    min: number | null;
    max: number | null;
  }[];
  db.close();
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      { classification: r.classification, currency: r.currency, min: r.min, max: r.max },
    ]),
  );
}

function skillsOf(path: string, jobId: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db
    .prepare(`SELECT skill_id AS s FROM job_skills WHERE job_id = ? ORDER BY skill_id`)
    .all(jobId) as unknown as { s: string }[];
  db.close();
  return rows.map((r) => r.s);
}

/** db/index.ts resolves AIENGJOBS_DB once, at load, so each run needs a fresh
 *  module registry to pick up this test's database. */
async function run(path: string): Promise<void> {
  process.env.AIENGJOBS_DB = path;
  vi.resetModules();
  const { retag } = await import("../engine/src/retag.ts");
  retag();
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.AIENGJOBS_DB;
});

describe("retag", () => {
  it("re-derives skills from the stored description text", async () => {
    const path = makeDb([
      { id: "a", title: "AI Engineer", text: "You will build RAG pipelines with Python." },
    ]);

    await run(path);

    expect(skillsOf(path, "a")).toContain("sk_rag");
    expect(skillsOf(path, "a")).toContain("sk_python");
  });

  it("demotes a stored IN whose title the OUT heuristics now reject", async () => {
    const path = makeDb([
      { id: "keep", title: "AI Engineer", text: "RAG." },
      { id: "drop", title: "Enterprise Account Executive", text: "RAG." },
    ]);

    await run(path);

    expect(readJobs(path).keep!.classification).toBe("in");
    expect(readJobs(path).drop!.classification).toBe("out");
    expect(skillsOf(path, "drop")).toEqual([]);
  });

  it("demotes a stored IN that sits below the confidence floor", async () => {
    const path = makeDb([{ id: "weak", title: "AI Engineer", text: "RAG.", conf: 0.4 }]);

    await run(path);

    expect(readJobs(path).weak!.classification).toBe("out");
  });
});

/**
 * The pay repair. Deliberately narrow: a stored row does not record whether its
 * range came from the feed's structured comp or from the prose, so the only
 * rows touched are ones where re-reading the description reproduces the same
 * figures under a different currency.
 */
describe("retag pay repair", () => {
  const CANADIAN = "The salary range for this role is $145100 - $217700 per year.";

  it("relabels a description-derived range onto the country's own currency", async () => {
    const path = makeDb([
      {
        id: "ca",
        title: "AI Engineer",
        text: CANADIAN,
        country: "CA",
        salaryMin: 145100,
        salaryMax: 217700,
        salaryCurrency: "USD",
      },
    ]);

    await run(path);

    expect(readJobs(path).ca).toMatchObject({ currency: "CAD", min: 145100, max: 217700 });
  });

  it("leaves a US role's dollars alone", async () => {
    const path = makeDb([
      {
        id: "us",
        title: "AI Engineer",
        text: CANADIAN,
        country: "US",
        salaryMin: 145100,
        salaryMax: 217700,
        salaryCurrency: "USD",
      },
    ]);

    await run(path);

    expect(readJobs(path).us!.currency).toBe("USD");
  });

  it("does not touch a range the description does not reproduce", async () => {
    // The signature of feed-supplied structured comp: the stored figures are
    // not the ones in the prose, so the pass has no evidence and stands down.
    const path = makeDb([
      {
        id: "feed",
        title: "AI Engineer",
        text: CANADIAN,
        country: "CA",
        salaryMin: 200000,
        salaryMax: 260000,
        salaryCurrency: "USD",
      },
    ]);

    await run(path);

    expect(readJobs(path).feed).toMatchObject({ currency: "USD", min: 200000, max: 260000 });
  });

  it("leaves an unpriced role unpriced", async () => {
    const path = makeDb([{ id: "none", title: "AI Engineer", text: CANADIAN, country: "CA" }]);

    await run(path);

    expect(readJobs(path).none!.currency).toBeNull();
  });

  it("is idempotent — a second pass changes nothing", async () => {
    const path = makeDb([
      {
        id: "ca",
        title: "AI Engineer",
        text: CANADIAN,
        country: "CA",
        salaryMin: 145100,
        salaryMax: 217700,
        salaryCurrency: "USD",
      },
    ]);

    await run(path);
    const first = readJobs(path);
    await run(path);

    expect(readJobs(path)).toEqual(first);
  });
});
