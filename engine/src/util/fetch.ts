import { USER_AGENT } from "./html.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchRetryOptions {
  /** Total attempts on HTTP 429 / timeout / network error (default 3). */
  attempts?: number;
  /** Per-attempt timeout — a hung feed must never stall the nightly run. */
  timeoutMs?: number;
}

/**
 * fetch() for ATS feeds: sets the bot User-Agent, aborts hung requests, and
 * retries with exponential backoff (500ms, 1s, 2s…) on HTTP 429, timeouts and
 * network errors. Non-429 HTTP errors return immediately — they're the
 * caller's domain (e.g. 404 = unknown board).
 */
export async function fetchRetry(
  url: string,
  init?: RequestInit,
  { attempts = 3, timeoutMs = 20_000 }: FetchRetryOptions = {},
): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 429 || i >= attempts - 1) return res;
    } catch (e) {
      if (i >= attempts - 1) throw e;
    }
    await sleep(500 * 2 ** i);
  }
}
