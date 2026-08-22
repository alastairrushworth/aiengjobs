import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job, SiteSnapshot } from "@aiengjobs/shared";
import {
  choosePicks,
  DAILY_PICK_SIZE,
  mergePick,
  readDailyPicks,
  writeDailyPicks,
} from "../engine/src/export/dailyPicks.ts";

const RUN = "2026-08-21T23:15:00.000Z";
const EARLIER_RUN = "2026-08-20T23:12:00.000Z";
const GENERATED = "2026-08-22T03:00:00.000Z";

function job(over: Partial<Job> & { slug: string }): Job {
  return {
    companyName: "Acme",
    companySlug: "acme",
    // Distinct per slug by default. The dedupe key is title + company +
    // location, so a shared title would silently collapse every fixture in a
    // test into one role — which is the dedupe working, and not what most of
    // these are measuring. The tests that *do* measure it set the title.
    title: `AI Engineer ${over.slug}`,
    normalizedTitle: `ai engineer ${over.slug}`,
    applyUrl: "https://acme.example/jobs/1",
    locationRaw: "London",
    country: "GB",
    skills: [],
    clusters: [],
    // listedJobs needs a posted date inside the age window, or the role isn't
    // listed at all and so can't be picked.
    postedAt: "2026-08-21T09:00:00.000Z",
    ingestedAt: RUN,
    ...over,
  };
}

function snapshot(jobs: Job[]): SiteSnapshot {
  return { generatedAt: GENERATED, fxRates: { USD: 1 }, jobs, companies: [] };
}

describe("choosePicks", () => {
  it("ranks this run's arrivals by model score, highest first", () => {
    const pick = choosePicks(
      snapshot([
        job({ slug: "mid", modelScore: 0.8 }),
        job({ slug: "top", modelScore: 0.99 }),
        job({ slug: "low", modelScore: 0.71 }),
      ]),
    );
    expect(pick?.slugs).toEqual(["top", "mid", "low"]);
  });

  it("takes only the top five", () => {
    const jobs = Array.from({ length: 9 }, (_, i) =>
      job({ slug: `job-${i}`, modelScore: 0.9 - i / 100 }),
    );
    expect(choosePicks(snapshot(jobs))?.slugs).toHaveLength(DAILY_PICK_SIZE);
  });

  it("ignores roles that arrived in an earlier run", () => {
    // The whole promise of the feed is that it carries what is *new*. A role
    // from last night was already offered, and scoring higher tonight is not a
    // reason to offer it again.
    const pick = choosePicks(
      snapshot([
        job({ slug: "tonight", modelScore: 0.75 }),
        job({ slug: "last-night", modelScore: 0.99, ingestedAt: EARLIER_RUN }),
      ]),
    );
    expect(pick?.slugs).toEqual(["tonight"]);
  });

  it("skips roles with no model score rather than defaulting them", () => {
    // Rows written before the column existed. A default would be a fabricated
    // ranking, and it would beat real scores below whatever value was chosen.
    const pick = choosePicks(
      snapshot([job({ slug: "scored", modelScore: 0.72 }), job({ slug: "legacy" })]),
    );
    expect(pick?.slugs).toEqual(["scored"]);
  });

  it("returns null when nothing in the run can be ranked", () => {
    expect(choosePicks(snapshot([job({ slug: "legacy" })]))).toBeNull();
  });

  it("returns null for an empty board", () => {
    expect(choosePicks(snapshot([]))).toBeNull();
  });

  it("keeps one requisition out of several identical ones", () => {
    // Employers open a requisition per office and each is a distinct posting.
    // Without deduping, one role takes every slot in the feed.
    const dup = (slug: string, modelScore: number) =>
      job({ slug, modelScore, title: "Forward Deployed Engineer", locationRaw: "Hyderabad" });
    const pick = choosePicks(
      snapshot([
        dup("fde-1", 0.98),
        dup("fde-2", 0.97),
        dup("fde-3", 0.96),
        job({ slug: "other", modelScore: 0.72, title: "Eval Engineer" }),
      ]),
    );
    expect(pick?.slugs).toEqual(["fde-1", "other"]);
  });

  it("excludes closed roles", () => {
    const pick = choosePicks(
      snapshot([
        job({ slug: "open", modelScore: 0.8 }),
        job({ slug: "closed", modelScore: 0.99, isClosed: true }),
      ]),
    );
    expect(pick?.slugs).toEqual(["open"]);
  });

  it("dates the pick by the run, not by when the export happened", () => {
    // The run starts at 23:15 and the export finishes after midnight, so the
    // two disagree on which day this is. The arrivals' own day is the honest
    // answer, and it is also what makes a re-export idempotent.
    expect(choosePicks(snapshot([job({ slug: "a", modelScore: 0.9 })]))?.date).toBe(
      "2026-08-21",
    );
  });

  it("orders deterministically when scores tie", () => {
    const tied = [
      job({ slug: "b", modelScore: 0.9, postedAt: "2026-08-21T09:00:00.000Z" }),
      job({ slug: "a", modelScore: 0.9, postedAt: "2026-08-21T09:00:00.000Z" }),
    ];
    expect(choosePicks(snapshot(tied))?.slugs).toEqual(["a", "b"]);
    expect(choosePicks(snapshot([...tied].reverse()))?.slugs).toEqual(["a", "b"]);
  });
});

describe("mergePick", () => {
  const pick = (date: string, slugs: string[]) => ({ date, pickedAt: GENERATED, slugs });

  it("appends a new night", () => {
    const merged = mergePick({ picks: [pick("2026-08-20", ["x"])] }, pick("2026-08-21", ["y"]));
    expect(merged.picks.map((p) => p.date)).toEqual(["2026-08-20", "2026-08-21"]);
  });

  it("leaves a night that is already recorded exactly as it was", () => {
    // A second export on the same day picks from a board that has moved on.
    // Restating the day's five would withdraw roles that had already gone out.
    const existing = { picks: [pick("2026-08-21", ["first", "second"])] };
    const merged = mergePick(existing, pick("2026-08-21", ["different"]));
    expect(merged.picks).toEqual(existing.picks);
  });

  it("keeps only the retained window, dropping oldest first", () => {
    const existing = {
      picks: Array.from({ length: 5 }, (_, i) => pick(`2026-08-0${i + 1}`, [`j${i}`])),
    };
    const merged = mergePick(existing, pick("2026-08-06", ["new"]), 3);
    expect(merged.picks.map((p) => p.date)).toEqual([
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
    ]);
  });

  it("is a no-op when there is nothing to pick", () => {
    const existing = { picks: [pick("2026-08-20", ["x"])] };
    expect(mergePick(existing, null)).toEqual(existing);
  });
});

describe("readDailyPicks", () => {
  it("treats a missing file as an empty ledger", () => {
    expect(readDailyPicks(join(tmpdir(), "definitely-not-here-9f3a.json"))).toEqual({
      picks: [],
    });
  });

  it("returns null for a file that exists but will not parse", () => {
    // Distinct from missing on purpose: absent means first run, broken means
    // the record of what has already been announced is unreadable.
    const dir = mkdtempSync(join(tmpdir(), "picks-"));
    const path = join(dir, "daily-picks.json");
    writeFileSync(path, "{ this is not json");
    try {
      expect(readDailyPicks(path)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeDailyPicks", () => {
  it("appends tonight's pick to the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "picks-"));
    const path = join(dir, "daily-picks.json");
    try {
      writeDailyPicks(snapshot([job({ slug: "a", modelScore: 0.9 })]), path);
      const written = JSON.parse(readFileSync(path, "utf8"));
      expect(written.picks).toEqual([
        { date: "2026-08-21", pickedAt: GENERATED, slugs: ["a"] },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a ledger it cannot read", () => {
    // Overwriting would drop the record of what has already gone out, and the
    // next run would re-announce a month of roles to every subscriber. One
    // missing day is the cheaper failure.
    const dir = mkdtempSync(join(tmpdir(), "picks-"));
    const path = join(dir, "daily-picks.json");
    writeFileSync(path, "{ broken");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      writeDailyPicks(snapshot([job({ slug: "a", modelScore: 0.9 })]), path);
      expect(readFileSync(path, "utf8")).toBe("{ broken");
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never throws, whatever the export hands it", () => {
    // It runs at the end of a successful export, and refresh.sh's exit code
    // decides whether the night's database is persisted at all.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        writeDailyPicks(snapshot([job({ slug: "a", modelScore: 0.9 })]), "/nope/nowhere.json"),
      ).not.toThrow();
    } finally {
      err.mockRestore();
    }
  });
});
