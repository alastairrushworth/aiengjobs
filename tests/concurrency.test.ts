import { describe, expect, it } from "vitest";
import { BREAKER_MIN_FAILURES, guardedPool, mapPool } from "../engine/src/util/concurrency.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapPool", () => {
  it("returns results in original order", async () => {
    const out = await mapPool([30, 10, 20], 3, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("caps in-flight concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("propagates a rejection to the caller", async () => {
    await expect(
      mapPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

describe("guardedPool", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("behaves like mapPool when every attempt succeeds", async () => {
    const out = await guardedPool(ids(6), 2, "acme", async (n, attempt) => {
      const v = await attempt(async () => n * 10);
      return v ?? -1;
    });
    expect(out).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it("degrades a single failure to undefined without tripping", async () => {
    const out = await guardedPool(ids(8), 2, "acme", async (n, attempt) => {
      const v = await attempt(async () => {
        if (n === 3) throw new Error("timeout");
        return n;
      });
      return v ?? "list-only";
    });
    expect(out[3]).toBe("list-only");
    expect(out.filter((v) => v === "list-only")).toHaveLength(1);
  });

  it("trips once failures reach the floor and the rate, and names the board", async () => {
    let started = 0;
    await expect(
      guardedPool(ids(250), 4, "workable intertek", async (_n, attempt) => {
        started++;
        await attempt(async () => {
          await sleep(1);
          throw new Error("timeout");
        });
        return null;
      }),
    ).rejects.toThrow(/workable intertek: detail fetches failing \(\d+ of \d+ threw\), gave up after \d+ of 250/);
    // Stopped scheduling soon after the fifth failure rather than draining all 250.
    expect(started).toBeLessThan(BREAKER_MIN_FAILURES + 4 * 2);
  });

  it("does not trip on a low failure rate over many items", async () => {
    // Six failures clears the floor, but 6% of 100 is well under the rate.
    const failAt = new Set([10, 20, 30, 40, 50, 60]);
    const out = await guardedPool(ids(100), 4, "acme", async (n, attempt) => {
      const v = await attempt(async () => {
        if (failAt.has(n)) throw new Error("timeout");
        return n;
      });
      return v ?? -1;
    });
    expect(out.filter((v) => v === -1)).toHaveLength(6);
    expect(out).toHaveLength(100);
  });

  it("returns undefined immediately from attempts made after the trip", async () => {
    let workCalls = 0;
    await expect(
      guardedPool(ids(40), 1, "acme", async (_n, attempt) => {
        await attempt(async () => {
          workCalls++;
          throw new Error("timeout");
        });
        return null;
      }),
    ).rejects.toThrow("acme");
    // Serial pool: the fifth failure trips it; the worker loop then exits.
    expect(workCalls).toBe(BREAKER_MIN_FAILURES);
  });
});
