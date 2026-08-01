/**
 * The remote entry point: the same five tools over Streamable HTTP, running on
 * a Cloudflare Worker. This is what browser clients need — claude.ai and
 * ChatGPT can't spawn a local process, so they take a URL instead.
 *
 * Stateless by design. Every request builds its own server and transport and
 * throws them away, which means no Durable Objects, no session storage and
 * nothing to clean up. The only thing that persists between requests is the
 * board itself, memoized at module scope in board.ts, so a warm isolate answers
 * without re-fetching the index.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { configure, loadBoard } from "./board.js";
import { createServer } from "./server.js";

interface Env {
  /** Where to read the board from. Set in wrangler.jsonc. */
  FRONTIERROLES_BASE_URL?: string;
}

/**
 * Browser-based MCP clients call this cross-origin, so preflight has to pass
 * and the session header has to be readable. Wide open on purpose: the data is
 * public and there is no cookie or credential for an origin check to protect.
 */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** What a person sees if they paste the endpoint into a browser. */
const LANDING = `frontierroles MCP server

Open AI-engineering roles from https://frontierroles.com, as MCP tools.
Every role is a first-party posting from the employer's own ATS: no sponsored
placement, no recruiter reposts, and apply links point at the employer.

  Endpoint   POST {origin}/mcp   (Streamable HTTP, no authentication)
  Tools      search_jobs, get_job, get_company, board_stats, list_skills
  Health     GET  {origin}/health

This URL is the MCP endpoint, not a web page — add it as a custom connector in
a client that supports remote MCP servers.
`;

async function handleMcp(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session ids, no per-session state to store between requests.
    sessionIdGenerator: undefined,
    // Answer with a plain JSON body rather than opening an SSE stream. These
    // tools return in single-digit milliseconds and never push anything
    // unprompted, so a stream would only hold a Worker connection open and bill
    // duration for nothing.
    enableJsonResponse: true,
  });

  const server = createServer();
  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    // Safe here only because enableJsonResponse means the body is fully built
    // before handleRequest resolves. With an SSE stream this would cut the
    // response off mid-flight.
    await server.close().catch(() => {});
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Workers have no process.env — configuration arrives per request.
    configure({ baseUrl: env.FRONTIERROLES_BASE_URL });

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/health") {
      try {
        const board = await loadBoard();
        return withCors(
          Response.json({
            ok: true,
            jobCount: board.jobCount,
            generatedAt: board.generatedAt,
          }),
        );
      } catch (err) {
        // The board is the only dependency, so failing to load it is the only
        // interesting failure — say so plainly rather than 500ing blankly.
        return withCors(
          Response.json({ ok: false, error: String(err) }, { status: 503 }),
        );
      }
    }

    // `/mcp` is the canonical endpoint, but clients are routinely configured
    // with a bare origin, so accept that too rather than 404ing a request that
    // is unambiguously MCP.
    const isMcpPath = url.pathname === "/mcp" || url.pathname === "/";
    if (isMcpPath && request.method === "POST") {
      return withCors(await handleMcp(request));
    }
    if (url.pathname === "/mcp" && (request.method === "GET" || request.method === "DELETE")) {
      return withCors(await handleMcp(request));
    }

    if (url.pathname === "/" && request.method === "GET") {
      return withCors(
        new Response(LANDING.replaceAll("{origin}", url.origin), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      );
    }

    return withCors(new Response("Not found", { status: 404 }));
  },
};
