import { USER_AGENT } from "./html.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ceiling on a declared response body. Feeds are a few MB at most; anything
 *  this size is a broken or hostile endpoint, and reading it would put the
 *  runner under memory pressure for the rest of the night. Only enforceable
 *  when the server declares Content-Length — the per-attempt timeout is what
 *  bounds a chunked body that never ends. */
const MAX_BYTES = 64 * 1024 * 1024;

export interface FetchRetryOptions {
  /** Total attempts on HTTP 429 / timeout / network error (default 3). */
  attempts?: number;
  /** Per-attempt timeout — a hung feed must never stall the nightly run. */
  timeoutMs?: number;
}

/** `Retry-After` as milliseconds, for the delta-seconds and HTTP-date forms.
 *  Returns null when absent or unparseable, and ignores absurd values so a
 *  feed cannot park the run for an hour. */
export function retryAfterMs(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Number.isNaN(Date.parse(trimmed))
      ? null
      : Date.parse(trimmed) - nowMs;
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, 30_000);
}

/**
 * fetch() for ATS feeds: sets the bot User-Agent, aborts hung requests, and
 * retries with exponential backoff (500ms, 1s, 2s…) on HTTP 429, timeouts and
 * network errors. A 429's `Retry-After` wins over the backoff when it asks for
 * longer. Non-429 HTTP errors return immediately — they're the caller's domain
 * (e.g. 404 = unknown board).
 */
export async function fetchRetry(
  url: string,
  init?: RequestInit,
  { attempts = 3, timeoutMs = 20_000 }: FetchRetryOptions = {},
): Promise<Response> {
  for (let i = 0; ; i++) {
    let backoffMs = 500 * 2 ** i;
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 429 || i >= attempts - 1) {
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_BYTES) {
          throw new Error(
            `response too large: ${declared} bytes from ${url} (cap ${MAX_BYTES})`,
          );
        }
        return res;
      }
      backoffMs = Math.max(backoffMs, retryAfterMs(res.headers.get("retry-after"), Date.now()) ?? 0);
    } catch (e) {
      if (i >= attempts - 1) throw e;
    }
    await sleep(backoffMs);
  }
}
