import { describe, expect, it } from "vitest";
import { MAX_JOB_AGE_DAYS } from "@aiengjobs/shared/indexable";
import { inTombstoneWindow, leftBoardAt } from "../site/src/lib/tombstone.ts";

const GENERATED_AT = "2026-11-20T00:00:00Z";
const WINDOW = 7;

const daysAgo = (n: number): string =>
  new Date(Date.parse(GENERATED_AT) - n * 86_400_000).toISOString();

/** A role posted `age` days ago that closed `closed` days ago — does it get a page? */
const tombstoned = (age: number, closed: number): boolean =>
  inTombstoneWindow({ postedAt: daysAgo(age) }, daysAgo(closed), GENERATED_AT, WINDOW);

describe("inTombstoneWindow", () => {
  it("keeps a page for a role that closed this week while still listed", () => {
    expect(tombstoned(40, 0)).toBe(true);
    expect(tombstoned(40, WINDOW)).toBe(true);
  });

  it("lets the URL go once the window has passed", () => {
    expect(tombstoned(40, WINDOW + 1)).toBe(false);
  });

  it("does not revive a URL that had already aged out and expired", () => {
    // Posted 31 Jul, aged out ~29 Oct, 404 from ~5 Nov, closed at the employer
    // 15 Nov: /jobs/openai-industrial-compute-7c82af/ on 2026-11-20. Its
    // closure is recent; its departure from the board is not.
    expect(tombstoned(112, 4)).toBe(false);
    expect(tombstoned(MAX_JOB_AGE_DAYS + WINDOW + 1, 0)).toBe(false);
  });

  it("counts from the age-out when the role closes inside its aged-out window", () => {
    // Aged out 5 days ago, closed yesterday: the page was still up, so it stays
    // — as a closed tombstone — until the week that began at the age-out ends.
    expect(tombstoned(MAX_JOB_AGE_DAYS + 5, 1)).toBe(true);
    expect(tombstoned(MAX_JOB_AGE_DAYS + WINDOW, 2)).toBe(true);
    expect(tombstoned(MAX_JOB_AGE_DAYS + WINDOW + 1, 2)).toBe(false);
  });

  it("treats an exit of unknown age as recent, as older snapshots expect", () => {
    expect(inTombstoneWindow({ postedAt: daysAgo(300) }, undefined, GENERATED_AT, WINDOW)).toBe(true);
    expect(inTombstoneWindow({ postedAt: daysAgo(300) }, "not a date", GENERATED_AT, WINDOW)).toBe(true);
  });

  it("falls back to the exit date alone when the role has no posted date", () => {
    expect(inTombstoneWindow({ postedAt: undefined }, daysAgo(3), GENERATED_AT, WINDOW)).toBe(true);
    expect(inTombstoneWindow({ postedAt: undefined }, daysAgo(30), GENERATED_AT, WINDOW)).toBe(false);
  });
});

describe("leftBoardAt", () => {
  it("is the earlier of the exit and the age-out", () => {
    const agedOut = Date.parse(daysAgo(100)) + MAX_JOB_AGE_DAYS * 86_400_000;
    expect(leftBoardAt({ postedAt: daysAgo(100) }, daysAgo(2))).toBe(agedOut);
    expect(leftBoardAt({ postedAt: daysAgo(50) }, daysAgo(2))).toBe(Date.parse(daysAgo(2)));
  });
});
