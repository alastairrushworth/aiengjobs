import { USER_AGENT } from "./html.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ceiling on a declared response body. Feeds are a few MB at most; anything
 *  this size is a broken or hostile endpoint, and reading it would put the
 *  runner under memory pressure for the rest of the night. Only enforceable
 *  when the server declares Content-Length — the per-attempt timeout is what
 *  bounds a chunked body that never ends. */
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Hostnames and literal addresses that are never a public web server: loopback,
 * link-local (which is where cloud metadata services live), and the RFC1918
 * private ranges.
 */
const PRIVATE_HOST =
  /^(?:localhost|.*\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|\[?::1\]?|\[?fe80:.*\]?|\[?fc00:.*\]?|\[?fd[0-9a-f]{2}:.*\]?)$/i;

/**
 * Is this a plain http(s) URL pointing somewhere on the public internet?
 *
 * The engine follows URLs it found in third-party payloads — a SmartRecruiters
 * `ref`, a `<link rel=icon href>` on a company's homepage — and those are
 * attacker-influenced in principle. Whatever comes back is parsed and can end
 * up published, so a request aimed at 169.254.169.254 or a private range is
 * both an information leak and a fetch we would never want to make.
 *
 * A hostname check only, deliberately: resolving the name here would still lose
 * to DNS rebinding, and defending against that means an agent that pins the
 * resolved address per connection. This closes the literal-address door, which
 * is the one an untrusted payload can actually reach through.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  return !PRIVATE_HOST.test(u.hostname);
}

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
