#!/usr/bin/env node
/**
 * The stdio entry point: one server per process, speaking JSON-RPC over stdin
 * and stdout. This is what Claude Code, Claude Desktop and Cursor spawn.
 *
 * Everything it offers is defined in server.ts, shared with the Worker.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { baseUrl } from "./board.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  // stdout is the protocol channel — anything written there that isn't JSON-RPC
  // corrupts the session, so diagnostics go to stderr.
  console.error(`frontierroles MCP server ready (data: ${baseUrl()})`);
}

main().catch((err) => {
  console.error("frontierroles MCP server failed to start:", err);
  process.exit(1);
});
