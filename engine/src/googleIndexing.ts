import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fetchRetry } from "./util/fetch.ts";
import {
  GOOGLE_INDEXING_ENDPOINT,
  GOOGLE_INDEXING_KEY,
  GOOGLE_INDEXING_QUOTA,
} from "./config.ts";

const SCOPE = "https://www.googleapis.com/auth/indexing";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Google caps a project at 380 requests/minute across all Indexing API
 * endpoints. Publishing one URL per request keeps the per-URL error reporting
 * that the multipart batch endpoint throws away, but it means a 700-URL churn
 * night would sail past that ceiling unpaced. 250ms between requests is 240/min
 * — comfortably under, and still only a few minutes for a night's worth.
 */
const MIN_REQUEST_INTERVAL_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface IndexingResult {
  /** URLs Google accepted, by notification type. */
  updated: number;
  deleted: number;
  /** Over the daily quota, so never attempted. */
  skipped: number;
  /** Attempted and rejected — a per-URL problem, not a run-level one. */
  failed: number;
  /** Set when the run stopped early; the reason is worth surfacing. */
  stopped?: string;
}

/**
 * Read the service-account key without ever putting it in a log line.
 *
 * Parse failures are reported by shape, not content: an error message carrying
 * a fragment of a private key would end up in the Actions log, which is public.
 */
function loadServiceAccount(): ServiceAccount | null {
  if (!GOOGLE_INDEXING_KEY) return null;

  const looksInline = GOOGLE_INDEXING_KEY.trimStart().startsWith("{");
  let text: string;
  try {
    text = looksInline ? GOOGLE_INDEXING_KEY : readFileSync(GOOGLE_INDEXING_KEY, "utf8");
  } catch {
    throw new Error("GOOGLE_INDEXING_KEY is neither JSON nor a readable file path");
  }

  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    throw new Error("GOOGLE_INDEXING_KEY is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_INDEXING_KEY is missing client_email or private_key");
  }

  return {
    client_email: parsed.client_email,
    // A key round-tripped through a shell env var can arrive with its newlines
    // still escaped, which fails signing with an opaque OpenSSL error.
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
    token_uri: parsed.token_uri,
  };
}

const b64url = (value: string): string => Buffer.from(value).toString("base64url");

/** A self-signed JWT asserting the service account's identity and scope. */
function signedJwt(sa: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri ?? DEFAULT_TOKEN_URI,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(sa.private_key, "base64url")}`;
}

/** Exchange the JWT for a bearer token. Valid an hour — one per run is plenty. */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const res = await fetchRetry(sa.token_uri ?? DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedJwt(sa, Math.floor(Date.now() / 1000)),
    }).toString(),
  });
  if (!res.ok) {
    // The body here describes the assertion, not the key, so it's safe to show
    // — and "invalid_grant" vs "invalid_client" is the whole diagnosis.
    throw new Error(
      `token exchange failed: HTTP ${res.status} — ${await res.text().catch(() => "")}`,
    );
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("token exchange returned no access_token");
  return body.access_token;
}

type Notification = { url: string; type: "URL_UPDATED" | "URL_DELETED" };

/**
 * Tell Google which job URLs appeared and which stopped carrying a JobPosting.
 *
 * Deletions go first for the same reason IndexNow's do: a dead listing in
 * someone's search results is worse than a new one arriving a day late. That
 * ordering matters more here, because the daily quota is small enough to run
 * out mid-run and whatever is left unsent is what gets dropped.
 *
 * Best-effort, like every other notifier — the caller treats failure as
 * non-fatal, because a missed notification costs freshness while a failed
 * refresh costs the board.
 */
export async function submitIndexing(
  updated: string[],
  deleted: string[],
): Promise<IndexingResult> {
  const result: IndexingResult = { updated: 0, deleted: 0, skipped: 0, failed: 0 };

  const all: Notification[] = [
    ...deleted.map((url): Notification => ({ url, type: "URL_DELETED" })),
    ...updated.map((url): Notification => ({ url, type: "URL_UPDATED" })),
  ];
  if (all.length === 0) return result;

  let sa: ServiceAccount | null;
  try {
    sa = loadServiceAccount();
  } catch (e) {
    result.stopped = e instanceof Error ? e.message : String(e);
    result.skipped = all.length;
    return result;
  }
  if (!sa) {
    result.stopped = "no key configured";
    result.skipped = all.length;
    return result;
  }

  const queue = all.slice(0, GOOGLE_INDEXING_QUOTA);
  result.skipped = all.length - queue.length;

  let token: string;
  try {
    token = await accessToken(sa);
  } catch (e) {
    result.stopped = e instanceof Error ? e.message : String(e);
    result.skipped = all.length;
    return result;
  }

  for (const [i, notification] of queue.entries()) {
    if (i > 0) await sleep(MIN_REQUEST_INTERVAL_MS);

    let res: Response;
    try {
      res = await fetchRetry(GOOGLE_INDEXING_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(notification),
      });
    } catch (e) {
      result.failed++;
      console.warn(`  ! Indexing API: ${notification.url} — ${e instanceof Error ? e.message : e}`);
      continue;
    }

    if (res.ok) {
      if (notification.type === "URL_DELETED") result.deleted++;
      else result.updated++;
      continue;
    }

    // 429 is the daily quota, and it will not clear before tomorrow. 403 means
    // the service account isn't a verified owner (or the API isn't enabled) and
    // every remaining URL would fail the same way. Both are run-level verdicts,
    // so stop rather than spend minutes collecting identical rejections.
    if (res.status === 429 || res.status === 403) {
      const detail = await res.text().catch(() => "");
      result.stopped =
        res.status === 429
          ? `daily quota exhausted (HTTP 429) — ${detail}`
          : `not authorized (HTTP 403) — check the service account is a verified Search Console owner — ${detail}`;
      result.skipped += queue.length - i;
      break;
    }

    result.failed++;
    console.warn(
      `  ! Indexing API: HTTP ${res.status} for ${notification.url} — ${await res.text().catch(() => "")}`,
    );
  }

  return result;
}
