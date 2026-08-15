import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Indexing API client is mostly credential handling and failure triage, so
 * these drive it against a throwaway HTTP server rather than mocking fetch: the
 * JWT is really signed, really exchanged, and the notifications really arrive
 * in the order and quantity the quota allows.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

interface Harness {
  server: Server;
  origin: string;
  assertions: string[];
  published: { url: string; type: string }[];
  authHeaders: (string | undefined)[];
}

/**
 * `publishStatus` decides what the publish endpoint returns for the Nth publish
 * request — counted per request, not per success, so a rejection still advances
 * the sequence.
 */
function harness(publishStatus: (n: number) => number = () => 200): Promise<Harness> {
  const assertions: string[] = [];
  const published: { url: string; type: string }[] = [];
  const authHeaders: (string | undefined)[] = [];
  let publishCalls = 0;

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/token") {
        assertions.push(new URLSearchParams(body).get("assertion") ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "test-token", expires_in: 3600 }));
        return;
      }
      const status = publishStatus(publishCalls++);
      if (status === 200) {
        authHeaders.push(req.headers.authorization);
        published.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      } else {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "nope" } }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}`, assertions, published, authHeaders });
    });
  });
}

/** Import the module fresh, since it reads its config at module scope. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return await import("../engine/src/googleIndexing.ts");
}

const serviceAccount = (tokenUri: string) =>
  JSON.stringify({
    client_email: "indexer@example.iam.gserviceaccount.com",
    private_key: privateKey,
    token_uri: tokenUri,
  });

let open: Server | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (open) await new Promise((r) => open!.close(r));
  open = null;
});

/** Start a harness and register its server for teardown. */
async function serve(publishStatus?: (n: number) => number): Promise<Harness> {
  const h = await harness(publishStatus);
  open = h.server;
  return h;
}

describe("submitIndexing", () => {
  it("does nothing, loudly, when no key is configured", async () => {
    const { submitIndexing } = await load({ GOOGLE_INDEXING_KEY: "" });
    const result = await submitIndexing(["https://x/a/"], ["https://x/b/"]);

    expect(result).toMatchObject({ updated: 0, deleted: 0, skipped: 2, stopped: "no key configured" });
  });

  it("reports a malformed key without echoing it", async () => {
    const { submitIndexing } = await load({ GOOGLE_INDEXING_KEY: '{"client_email":"a@b"}' });
    const result = await submitIndexing(["https://x/a/"], []);

    expect(result.stopped).toBe("GOOGLE_INDEXING_KEY is missing client_email or private_key");
    expect(result.skipped).toBe(1);
  });

  it("signs a scoped assertion and sends deletions before updates", async () => {
    const h = await serve();
    const { submitIndexing } = await load({
      GOOGLE_INDEXING_KEY: serviceAccount(`${h.origin}/token`),
      GOOGLE_INDEXING_ENDPOINT: `${h.origin}/publish`,
      GOOGLE_INDEXING_QUOTA: "10",
    });

    const result = await submitIndexing(
      ["https://x/new-1/", "https://x/new-2/"],
      ["https://x/gone-1/"],
    );

    expect(result).toMatchObject({ updated: 2, deleted: 1, failed: 0, skipped: 0 });
    expect(result.stopped).toBeUndefined();

    // A dead listing in someone's results is worse than a new one arriving late.
    expect(h.published).toEqual([
      { url: "https://x/gone-1/", type: "URL_DELETED" },
      { url: "https://x/new-1/", type: "URL_UPDATED" },
      { url: "https://x/new-2/", type: "URL_UPDATED" },
    ]);

    // One token, reused for every notification.
    expect(h.assertions).toHaveLength(1);
    expect(new Set(h.authHeaders)).toEqual(new Set(["Bearer test-token"]));

    const claims = JSON.parse(
      Buffer.from(h.assertions[0].split(".")[1], "base64url").toString(),
    );
    expect(claims).toMatchObject({
      iss: "indexer@example.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/indexing",
      aud: `${h.origin}/token`,
    });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it("spends the daily quota on deletions first and skips the overflow", async () => {
    const h = await serve();
    const { submitIndexing } = await load({
      GOOGLE_INDEXING_KEY: serviceAccount(`${h.origin}/token`),
      GOOGLE_INDEXING_ENDPOINT: `${h.origin}/publish`,
      GOOGLE_INDEXING_QUOTA: "2",
    });

    const result = await submitIndexing(
      ["https://x/new-1/", "https://x/new-2/"],
      ["https://x/gone-1/"],
    );

    expect(result).toMatchObject({ updated: 1, deleted: 1, skipped: 1, failed: 0 });
    expect(h.published.map((p) => p.url)).toEqual(["https://x/gone-1/", "https://x/new-1/"]);
  });

  it("stops on the daily-quota rejection instead of collecting identical 429s", async () => {
    const h = await serve((n) => (n >= 1 ? 429 : 200));
    const { submitIndexing } = await load({
      GOOGLE_INDEXING_KEY: serviceAccount(`${h.origin}/token`),
      GOOGLE_INDEXING_ENDPOINT: `${h.origin}/publish`,
      GOOGLE_INDEXING_QUOTA: "10",
    });

    const result = await submitIndexing(["https://x/a/", "https://x/b/", "https://x/c/"], []);

    expect(result.updated).toBe(1);
    expect(result.stopped).toMatch(/daily quota exhausted/);
    // The two it never got to are skipped, not counted as failures.
    expect(result).toMatchObject({ failed: 0, skipped: 2 });
  });

  it("stops on 403 and names the likely cause", async () => {
    const h = await serve(() => 403);
    const { submitIndexing } = await load({
      GOOGLE_INDEXING_KEY: serviceAccount(`${h.origin}/token`),
      GOOGLE_INDEXING_ENDPOINT: `${h.origin}/publish`,
      GOOGLE_INDEXING_QUOTA: "10",
    });

    const result = await submitIndexing(["https://x/a/", "https://x/b/"], []);

    expect(result.updated).toBe(0);
    expect(result.stopped).toMatch(/verified Search Console owner/);
    expect(result.skipped).toBe(2);
  });

  it("counts a per-URL rejection and carries on", async () => {
    const h = await serve((n) => (n === 0 ? 400 : 200));
    const { submitIndexing } = await load({
      GOOGLE_INDEXING_KEY: serviceAccount(`${h.origin}/token`),
      GOOGLE_INDEXING_ENDPOINT: `${h.origin}/publish`,
      GOOGLE_INDEXING_QUOTA: "10",
    });

    const result = await submitIndexing(["https://x/bad/", "https://x/good/"], []);

    expect(result).toMatchObject({ updated: 1, failed: 1, skipped: 0 });
    expect(result.stopped).toBeUndefined();
  });
});
