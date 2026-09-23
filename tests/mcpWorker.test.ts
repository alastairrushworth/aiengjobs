import { afterEach, describe, expect, it, vi } from "vitest";
import { resetCache } from "../mcp/src/board.ts";
import worker from "../mcp/src/worker.ts";

/**
 * The HTTP surface of the remote server. What matters most is what an idle
 * client meets: an MCP client that GETs the endpoint for a server-push stream
 * and gets a 200 that ends at once reconnects in a loop, forever. The spec's
 * answer for "no stream here" is 405, which clients treat as final.
 */

const ENV = { FRONTIERROLES_BASE_URL: "https://frontierroles.com" };
const ORIGIN = "https://mcp.frontierroles.com";

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ENV,
  );
}

describe("worker", () => {
  it.each(["GET", "DELETE"])("answers %s /mcp with 405 rather than a stream", async (method) => {
    const res = await call(method, "/mcp");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    // Browser clients read this cross-origin, so the 405 has to be readable too.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("still initializes over POST", async () => {
    const res = await call("POST", "/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBeTruthy();
  });

  it("still serves the landing text on GET /", async () => {
    const res = await call("GET", "/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`${ORIGIN}/mcp`);
  });
  it("refuses an oversized query before searching the board", async () => {
    // One request of "a a a …" would otherwise run a substring check per term
    // against every role on the board.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await call("POST", "/mcp", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "search_jobs", arguments: { query: "a ".repeat(5_000) } },
    });
    const body = JSON.stringify(await res.json());
    expect(body).toMatch(/too_big|at most|200/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("marks every response nosniff", async () => {
    for (const [method, path] of [["GET", "/"], ["GET", "/mcp"], ["GET", "/nope"]] as const) {
      const res = await call(method, path);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});

describe("health", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCache();
  });

  it("reports a failed board load without echoing the error", async () => {
    resetCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.7:443 via internal-proxy");
      }),
    );
    const res = await call("GET", "/health");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("ECONNREFUSED");
    expect(JSON.parse(text)).toEqual({ ok: false, error: "board unavailable" });
    // Still logged, where the owner can read it.
    expect(console.error).toHaveBeenCalled();
  });
});
