import { describe, expect, it } from "vitest";
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
});
