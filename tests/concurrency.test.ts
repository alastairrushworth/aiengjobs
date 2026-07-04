import { describe, expect, it } from "vitest";
import { mapPool } from "../engine/src/util/concurrency.ts";

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
