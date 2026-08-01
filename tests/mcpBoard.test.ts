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

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
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
    const spy = vi.fn(async () => okResponse(BOARD));
    vi.stubGlobal("fetch", spy);
    await loadBoard();
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
