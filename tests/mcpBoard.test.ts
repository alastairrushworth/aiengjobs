import { afterEach, describe, expect, it, vi } from "vitest";
import type { Board } from "../mcp/src/board.ts";
import { configure, loadBoard, resetCache } from "../mcp/src/board.ts";

/**
 * board.ts is the only part of the MCP server that touches the network, so its
 * failure modes are the ones an agent actually meets: the site is slow, or down,
 * or the DNS entry is briefly wrong. What matters is that none of those becomes
 * a hung tool call or a silently discarded cache.
 *
 * The cache TTL is an hour, so every revalidation here is forced by advancing
 * fake timers rather than by waiting.
 */

const BOARD: Board = {
  generatedAt: "2026-08-01T10:56:07.871Z",
  jobCount: 1,
  clusters: [],
  fxRates: { USD: 1 },
  jobs: [],
};

const HOUR_AND_A_BIT = 61 * 60 * 1000;

/** A real Response, so a mock typed as `fetch` type-checks against it. */
function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetCache();
});

describe("loadBoard", () => {
  it("keeps serving the cached board when revalidation throws", async () => {
    vi.useFakeTimers();
    configure({ baseUrl: "https://example.test" });

    vi.stubGlobal("fetch", vi.fn(async () => okResponse(BOARD)));
    expect((await loadBoard()).generatedAt).toBe(BOARD.generatedAt);

    // Expire the entry so the next call really goes to the network, then make
    // that call throw. A DNS failure, TLS error, reset or timeout throws out of
    // fetch rather than returning a bad status — the case that used to bypass
    // the stale-board fallback and discard the cache entirely.
    vi.advanceTimersByTime(HOUR_AND_A_BIT);
    const throwing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", throwing);

    expect((await loadBoard()).generatedAt).toBe(BOARD.generatedAt);
    expect(throwing).toHaveBeenCalledTimes(1); // it really did try
  });

  it("throws a useful error when it fails with nothing cached", async () => {
    configure({ baseUrl: "https://example.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(loadBoard()).rejects.toThrow(/Could not reach https:\/\/example\.test/);
  });

  it("bounds the request with a timeout signal", async () => {
    configure({ baseUrl: "https://example.test" });
    // Typed as the real fetch so `calls[0]` carries its argument tuple —
    // `vi.fn(async () => …)` infers a zero-argument mock, and indexing an empty
    // tuple is how this read `undefined` and asserted nothing.
    const spy = vi.fn<typeof fetch>(async () => okResponse(BOARD));
    vi.stubGlobal("fetch", spy);
    await loadBoard();
    const init = spy.mock.calls[0]![1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

/**
 * A stale board beats no board while the site is briefly unreachable — but only
 * briefly. Each fallback used to reset the TTL, so a site that stayed down had
 * its last good board served indefinitely, one quiet hour at a time.
 */
describe("loadBoard staleness bound", () => {
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  /** Prime the cache with one successful load, then make every fetch fail. */
  async function primeThenFail(): Promise<void> {
    configure({ baseUrl: "https://example.test" });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => okResponse(BOARD)));
    await loadBoard();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
  }

  it("serves the last good board while the outage is short", async () => {
    vi.useFakeTimers();
    await primeThenFail();

    vi.advanceTimersByTime(HOUR_AND_A_BIT);

    await expect(loadBoard()).resolves.toEqual(BOARD);
  });

  it("stops serving it once the outage passes the staleness limit", async () => {
    vi.useFakeTimers();
    await primeThenFail();

    // Six revalidations, each an hour apart, each falling back. Under the old
    // behaviour every one of them re-armed the TTL and this never expired.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(HOUR_AND_A_BIT);
      await loadBoard().catch(() => undefined);
    }

    vi.advanceTimersByTime(SIX_HOURS);
    await expect(loadBoard()).rejects.toThrow(/staleness limit/);
  });

  it("a 304 counts as the origin confirming the copy, so the clock resets", async () => {
    vi.useFakeTimers();
    configure({ baseUrl: "https://example.test" });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => okResponse(BOARD)));
    await loadBoard();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 304 })),
    );
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(HOUR_AND_A_BIT);
      await loadBoard();
    }

    // Eight hours of 304s is a healthy origin, not a stale board.
    await expect(loadBoard()).resolves.toEqual(BOARD);
  });
});
