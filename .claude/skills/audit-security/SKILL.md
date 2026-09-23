---
name: audit-security
description: Run a thorough, adversarial, threat-model-driven security review of the WHOLE deployed frontierroles.com system — the static site on GitHub Pages, the public MCP server (Cloudflare Worker at mcp.frontierroles.com), the Cloudflare account and DNS, the GitHub repo and its Actions secrets (Cloudflare token, Google Indexing service-account key, Claude OAuth token), the nightly pipeline that turns third-party ATS feeds into published pages, dependencies and the model/snapshot supply chain. Use when the user asks to security-audit, pen-test, threat-model, harden, or check the site/MCP server for vulnerabilities, secret leaks, injection, XSS, SSRF, abuse/cost/DoS, prompt injection through the MCP tools, supply-chain or CI risks, DNS/subdomain takeover, security headers, or privacy/consent. This is the "what could an attacker DO to this system, its visitors, the people whose AI assistants call it, and the owner's accounts" pass — distinct from audit-code (source correctness, which only checks that the guards are implemented) and audit-site (rendered output, which only checks that they are used); also distinct from the built-in security-review skill, which is scoped to the current diff. Read-only by default; produces a prioritized, exploitability-ranked findings report.
---

# Security Audit — frontierroles.com

**Read `.claude/audit-conventions.md` first** — the shared operating rules,
known non-issues and report rules apply here too. This file adds the security
lens.

A deep, **adversarial** review of the entire deployed system. The question is
not "is the code clean?" but **"what can an attacker actually do — to the
owner's accounts, to the board's integrity, to the site's availability and the
owner's bill, to visitors' browsers, and to the AI assistants that call the MCP
server — and how do we cheaply reduce that?"** Think like an attacker first,
then like the defender. Think hard; favour thoroughness over speed.

The owner is **not a security specialist**, so every finding must explain in
plain language *what the attacker gains*, *how realistic it is*, and *the
cheapest effective fix*. Spell out CSP, SSRF, HSTS, DNSSEC and the like the
first time they appear.

**Lessons live in this file.** When a run teaches something — a probe that
lied, a baseline that moved, a false positive nearly reported — write it into
the section it belongs to, in the same change as the fix. This skill was
adapted from `../cyclearchive.com/.claude/skills/audit-security/`, which has
run several times against the same Cloudflare account; its lessons that
transfer are already folded in below.

## How this differs from the other audits

`audit-code` §2 and `audit-site` §9 each carry a security bullet list. They ask
whether a guard is **implemented** correctly (`safeUrl`, `jsonLdScript`,
`xmlEscape`, parameterised SQL) and whether it is **used** everywhere it must
be. This skill is the deep pass behind both, and differs in three ways:

1. **Lens — adversarial.** A correctly functioning feature can still be the
   problem: an unauthenticated endpoint that works perfectly and runs up a
   quota, a CI secret that is scoped far wider than its one job needs.
2. **Unit of analysis — the deployed system and its trust boundaries**, not
   files. GitHub Pages ↔ Cloudflare zone ↔ Worker ↔ GitHub Actions ↔ Google
   Search Console ↔ the ATS feeds ↔ other people's LLM sessions.
3. **Method — measure, don't only read.** It runs `npm audit` and a secret
   scan, probes live headers, TLS and CORS, reads the Cloudflare zone and the
   GitHub repo settings through their APIs, and reasons about cost.

**Avoid duplicating findings, not files.** A pure quality, SEO, a11y or layout
issue gets one line — `→ audit-code: …` / `→ audit-site: …` — and nothing more.
If only the pending diff needs checking, point the user at `security-review`.

## The system and its trust boundaries

Orient on *this* architecture before hunting. Baselines below were read on
**2026-09-23**; they are what "unchanged" means, not targets.

- **Static site — GitHub Pages, apex `frontierroles.com`.** Built by
  `.github/workflows/deploy.yml` (Pages source = GitHub Actions; the custom
  domain lives in repo settings, `site/public/CNAME` ships as insurance).
  `https_enforced: true`. **DNS-only, not proxied**: four apex `A` + four
  `AAAA` records point straight at GitHub's Pages IPs, `www` is a DNS-only
  CNAME to `alastairrushworth.github.io`. The site therefore answers as
  `server: GitHub.com` and **no Cloudflare setting reaches it** — no Transform
  Rule headers, no HSTS toggle, no WAF, no rate rule, no Bot Fight Mode. GitHub
  Pages sets no security headers and cannot be told to. Static, no cookies of
  its own, no logins, no forms. The only third-party script is GA4
  (`G-F8NGE6G65G`, `Base.astro`).
- **The MCP server — Cloudflare Worker `frontierroles-mcp`**
  (`mcp/src/worker.ts`, deployed by `.github/workflows/deploy-mcp.yml`) at
  `mcp.frontierroles.com` (Worker custom domain, proxied `AAAA 100::`).
  **The only thing in the system that executes on request.** Unauthenticated
  and CORS `*` by design; stateless; reads the board from the site's own
  `/mcp-index.json` and `/mcp-jobs/<slug>.json` with an in-isolate cache.
  The `workers.dev` route is **disabled** (`frontierroles-mcp.alastair-e55.
  workers.dev` answers Cloudflare error 1042) — so the custom domain is the
  sole entry point and zone rules *would* cover it. Today the zone has **no
  rules of any kind** (every phase entrypoint returns `10003`).
- **The Cloudflare account** (`e55d77b5f4abc3dd6e284bb3a784d8be`) holds
  **three zones — frontierroles.com, alastairrushworth.com, cyclearchive.com**
  — plus this Worker. All Free plan. Takeover of the account = DNS and traffic
  for all three. `alastairrushworth.com` carries the redirect rule that 301s
  the old `/aiengjobs/*` URLs here. Account-level controls (members, 2FA, API
  tokens) are shared with the cyclearchive audit: its `audit-security` recorded
  2FA `true` on 2026-09-23 — read its latest verdict rather than re-deriving
  it, but report anything that affects this system.
- **GitHub repo `alastairrushworth/aiengjobs` — public.** A push to `main`
  deploys to production (`deploy.yml`, and `deploy-mcp.yml` for `mcp/**`).
  `main` has **no branch protection**. Default workflow token is `read`;
  `allowed_actions: all`, `sha_pinning_required: false`. State lives on the
  detached `snapshot` branch (force-pushed nightly) and the `db-latest` and
  model release assets.
- **Actions secrets** (names only — never values): `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` (`deploy-mcp.yml`, handed to
  `cloudflare/wrangler-action`), `GOOGLE_INDEXING_KEY` (a service-account JSON
  key for GCP project `frontierroles`, used by `engine/src/googleIndexing.ts`
  in the nightly `notify`), `CLAUDE_CODE_OAUTH_TOKEN` (`claude.yml`,
  `claude-code-review.yml`). Repo variable `GOOGLE_INDEXING_QUOTA`.
- **The nightly pipeline** (`refresh.yml` → `scripts/refresh.sh` →
  `engine/src/cli.ts refresh`): fetches ~1,700 companies' boards from 15 ATS
  connectors, classifies with a local ONNX model (no API key), exports
  `snapshot.json`, pushes the `snapshot` branch, publishes `db-latest`, pings
  Google's Indexing API and IndexNow. Not internet-facing, but it **writes
  everything the site and the MCP server serve** — it is the upstream of every
  injection data-flow.
- **Google Search Console** property for frontierroles.com. The service
  account is a (delegated) **Owner** — the Indexing API requires that, so it is
  not over-privilege, but it makes the key a high-value secret.

**Actors to model:** an anonymous internet client hitting the MCP server; a
scanner or bot farm; an employer — or whoever controls a seeded company's ATS
board — writing a posting that the pipeline republishes verbatim; someone who
shares a crafted link with a victim; a malicious or compromised npm package or
GitHub Action; anyone who obtains a CI secret, a GitHub token, or the
Cloudflare login. **The one actually observed:** two people's idle MCP clients
re-polling `GET /mcp` (a stream the Worker opens and closes at once) drove the
Worker from ~100 to 21k requests/day by 2026-09-21 — cost and availability,
not an attack. Fixed by answering 405 (PR #38, live 2026-09-23; see §B). Scanners probing `/.env` and CVE paths were ~600
requests of noise.

**Assets, in rough priority for a one-person, no-PII job board:**
(1) the **Cloudflare account and the GitHub repo/account** — either one is a
production deploy; (2) the **Search Console property**, via the service-account
key; (3) **integrity of the board** — a poisoned snapshot or injected listing
reaches the site, the feeds, Google for Jobs and every MCP client;
(4) **availability and the owner's quotas/bill** (Workers, Actions, Google);
(5) **visitors' browsers** and **downstream LLM sessions**. There are **no user
accounts, no logins, no payments and no visitor PII** — calibrate to that.

## Operating rules

- **Read-only and non-destructive by default.** Produce findings; don't edit
  unless asked. **Never run a real attack** — no load tests, no fuzzing the
  live Worker, no scanning of GitHub or Cloudflare infrastructure. Probes are
  benign, low-volume checks against the owner's own endpoints: one `curl -sI`,
  one preflight, one handshake per TLS version.
- **Never print a secret value.** Report names and locations only. If a real
  leak turns up, say where and recommend rotation. Never build a "mask the
  value" `sed` for a finding — macOS `sed` has no `\s`, the mask silently
  fails and the value prints (cyclearchive, 2026-09-18). Print the key *name*
  with `cut -d= -f1`.
- **Zone, repo and account writes are the user's call, one change at a time.**
  A Cloudflare rule or setting, a DNS record, a repo setting or a secret change
  is a live production change. In auto mode the permission classifier denies
  them regardless; don't try a second route after a denial — say what you need
  and let the user decide. A `PUT` on a ruleset phase entrypoint **replaces the
  whole rule list**: read first.
- **Verify exploitability before asserting.** Prefer a reasoning chain
  ("attacker sends X → Y happens → impact Z") or a benign proof. If you can't
  confirm, mark **"needs verification"** with the probe that would.
- **Read the advisory's affected range before reporting a CVE.** cyclearchive
  nearly reported a High against a version outside the vulnerable range off a
  summary line.
- **Rank by exploitability × impact on this system.** A no-PII static board
  earns calm severities. An account or deploy-credential compromise outranks a
  missing header by a wide margin.
- **Cite evidence**: `file:line`, or the probe command and its output.

## Step 0 — Run the tooling and probe the live surface

Do as much as the environment allows; convert anything that can't run into a
"verify out-of-band" item rather than guessing.

```bash
# ── Dependency CVEs — one lockfile covers all four workspaces ─────────────
npm audit --omit=dev            # what ships (the Worker's deps, the site build's runtime)
npm audit                       # everything, dev included — rank dev-only advisories Low
npm ls @modelcontextprotocol/sdk zod wrangler --depth=0 -w @aiengjobs/mcp

# ── Secret exposure ───────────────────────────────────────────────────────
git ls-files | grep -E '(^|/)\.env$|\.pem$|\.key$|secret|credential|service.?account' || echo "no secret-like tracked files"
git log --all --oneline -- '*.env' engine/.env | head       # ever committed? names only, never -p
# gitleaks, if installed (brew install gitleaks). --redact keeps values out of output.
# Expected hits that are NOT leaks: INDEXNOW_KEY in engine/src/config.ts and its
# twin site/public/<key>.txt (public by design — see conventions).
gitleaks git --no-banner --redact=100 --log-opts="--all" .
sed -E 's/=.*//' engine/.env 2>/dev/null                     # key NAMES in a local .env, if any

# ── Live site: GitHub Pages, DNS-only ─────────────────────────────────────
curl -sS -D - https://frontierroles.com/ -o /dev/null | grep -iE '^HTTP|server|cache-control|content-security|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
#   expect server: GitHub.com and none of the security headers. If `server:
#   cloudflare` appears, the apex has been proxied — re-read §E and §H, because
#   the SSL-mode trap and the zone's cache settings now apply.
curl -sS -D - -o /dev/null https://www.frontierroles.com/ | grep -iE '^HTTP|location'     # 301 → apex
curl -sS -D - -o /dev/null https://alastairrushworth.com/aiengjobs/ | grep -iE '^HTTP|location'  # 301 → frontierroles.com

# ── The MCP Worker ────────────────────────────────────────────────────────
MCP=https://mcp.frontierroles.com
curl -sS -D - "$MCP/health" -o /dev/null | grep -iE '^HTTP|content-type|x-content-type|content-security|strict-transport'
curl -sS -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' -D - -o /dev/null "$MCP/mcp" | grep -i 'access-control'
curl -sS -o /dev/null -w 'GET /mcp -> %{http_code} %{content_type}\n' -H 'Accept: text/event-stream' "$MCP/mcp"
#   expect 405 (fixed 2026-09-23). 200 + text/event-stream = the reconnect loop is back (§B).
curl -sS https://frontierroles-mcp.alastair-e55.workers.dev/health | head -c 80; echo
#   expect "error code: 1042" (workers.dev route disabled). Anything else means a
#   second hostname that bypasses every zone rule.
# TLS floor on the proxied host — one handshake per version. 1.0/1.1 should FAIL (000).
for v in 1.0 1.1 1.2; do printf 'TLS %s: ' $v; curl -sS -o /dev/null --tlsv$v --tls-max $v -w '%{http_code}\n' "$MCP/health" 2>&1 | tail -1; done

# ── GitHub repo posture ───────────────────────────────────────────────────
R=alastairrushworth/aiengjobs
gh api repos/$R/pages --jq '{cname, https_enforced, protected_domain_state}'
gh api repos/$R/actions/permissions --jq .                  # allowed_actions, sha_pinning_required
gh api repos/$R/actions/permissions/workflow --jq .         # default token perms
gh api repos/$R/branches/main/protection 2>&1 | head -2     # 404 = unprotected
gh secret list -R $R; gh variable list -R $R                # names + updated dates only
grep -rnE 'uses: [^ ]+@' .github/workflows/ | grep -vE '@[0-9a-f]{40}' # every tag-pinned action
ls .github/dependabot.yml 2>/dev/null || echo "no Dependabot config"
grep -nE 'pull_request_target|workflow_run' .github/workflows/*.yml || echo "no privileged PR triggers"
```

**The Cloudflare zone and account are read through the Cloudflare MCP
server**, not the dashboard: one `ToolSearch` for
`mcp__plugin_cloudflare_cloudflare__execute` (and `…__search` for the OpenAPI
spec). If only `…__authenticate` is listed, hand the URL to the user — an
OAuth grant is theirs. Zone `6befb1fc21ca8a3cedfafca19330bfef`
(frontierroles.com), account pre-set as `accountId`. One `execute` call can
read everything; wrap each request in `try/catch`, because
`cloudflare.request()` **throws** on an API error and one failure otherwise
loses the whole result. Read, and **print whole objects** (cyclearchive lost
eight days to a check that printed two fields of `bot_management` while a
third flipped):

- `GET /zones/{z}/dns_records` · `/settings` · `/bot_management` · `/dnssec`
- `GET /zones/{z}/rulesets/phases/<phase>/entrypoint` for
  `http_request_firewall_custom`, `http_ratelimit`,
  `http_request_cache_settings`, `http_request_dynamic_redirect`,
  `http_response_headers_transform` — error `10003 could not find entrypoint`
  means **zero rules**, not a failure.
- `GET /accounts/{a}/workers/scripts` · `/workers/domains` ·
  `/workers/subdomain` · `/workers/account-settings`
- Worker traffic: GraphQL `workersInvocationsAdaptive` grouped by
  `datetimeHour` (max range ~4 weeks). The Observability `telemetry/query`
  group-bys silently drop rows with a null key, and its timeseries mode 504s
  over 8 days.
- The grant **cannot** list API tokens (error 9109) or read billing/
  subscriptions (error 10000) — those stay out-of-band checks.

Baseline, 2026-09-23 — diff against it:

| What | State |
|---|---|
| DNS | apex 4×`A` + 4×`AAAA` → GitHub Pages, **DNS-only**; `www` CNAME → `alastairrushworth.github.io`, DNS-only; `TXT` google-site-verification; `mcp` `AAAA 100::` **proxied** (Worker custom domain). Nothing else. |
| Settings | `ssl` full, `min_tls_version` **1.0**, `always_use_https` **off**, HSTS **off**, `browser_cache_ttl` 14400, `cache_level` aggressive, `email_obfuscation` on, `rocket_loader` off, `http3` on. Only the `mcp` host is proxied, so these reach nothing else today. |
| Rules | none in any phase |
| `bot_management` | everything off (`fight_mode` false, every `ai_*` disabled) |
| DNSSEC | **disabled** |
| Workers | one script, `frontierroles-mcp`, usage model `standard`; one custom domain; `workers.dev` route disabled (1042) |
| GitHub | public; Pages `https_enforced: true`, `protected_domain_state: null` (domain **not verified**); `main` unprotected; default token `read`; `allowed_actions: all`; `sha_pinning_required: false`; no Dependabot |

## Review dimensions

Work through every dimension. For each, note what is already safe as well as
what is exposed. Tie each finding to an actor and an asset from the map.

### A. Secrets and credentials

- **Tracked files and history**: nothing secret-like tracked, no `.env` ever
  committed, `engine/.env.example` holds placeholders only. The engine calls no
  paid API — classification is local — so any `OPENAI_*`/`ANTHROPIC_*` key in
  code, workflow or a local `.env` is a dead credential: revoke it at the
  provider and delete it.
- **`CLOUDFLARE_API_TOKEN`** — the widest secret in the repo. The account holds
  three zones; a token with account-wide Zone or DNS edit handed to a
  compromised `wrangler-action` would reach cyclearchive.com and
  alastairrushworth.com too. What the deploy needs is **Workers Scripts: Edit**
  on this account, plus whatever `custom_domain` needs on the frontierroles.com
  zone only. The MCP grant cannot list tokens: ask the owner to open
  Cloudflare → My Profile → API Tokens and report the token's permissions and
  zone scope. "needs verification" until then.
- **`GOOGLE_INDEXING_KEY`** — a GCP service-account JSON key, Owner on the
  Search Console property (Owner is what the Indexing API requires — don't
  report it as over-privilege). What an attacker gains with it: `URL_DELETED`
  for every page on the site, sitemap tampering, Search Console settings. Check
  it is only read in `notify` (`engine/src/config.ts`, `googleIndexing.ts`),
  never logged (the config comment says so — verify the log paths), and whether
  the key has a rotation date. A key-less option exists — Workload Identity
  Federation from GitHub OIDC — worth naming as the structural fix, not as
  urgent.
- **`CLAUDE_CODE_OAUTH_TOKEN`** — exposure is the owner's Claude quota.
  `claude.yml` runs on `issue_comment`/`issues` (which *do* receive secrets on a
  public repo) and is gated on `author_association` OWNER/MEMBER/COLLABORATOR
  plus an `@claude` mention — verify the gate covers **every** trigger branch.
  `claude-code-review.yml` runs on `pull_request`, which withholds secrets from
  fork PRs — verify no workflow uses `pull_request_target` or `workflow_run`
  with an untrusted checkout.
- **Logs**: nothing in `refresh.sh`, the engine or the Worker prints a secret or
  a full feed body (grep the log statements; a nightly run's log is public on a
  public repo).

### B. The MCP Worker — abuse, cost and availability

The crown jewel: the only surface that executes on request.

- **Authentication**: none, by design (public data, public board). That makes
  abuse and quota the primary risk — reason about it rather than waving it
  through.
- **Request volume and cost.** The Worker's plan is not readable through the
  MCP grant — ask. On Workers **Free** the account has a 100,000 requests/day
  cap across all Workers: exceed it and the MCP server returns errors until UTC
  midnight (availability, not a bill). On **Paid** it bills per million. The
  observed load (21k/day on 2026-09-21, ~98% `GET /mcp` from two idle clients)
  was a fifth of the Free cap from two people.
- **The `GET /mcp` reconnect loop — fixed, keep it fixed.** The SDK transport
  answered GET with 200 + an SSE stream that the `finally { server.close() }`
  ended at once, so compliant clients reconnected forever. Since PR #38
  (live 2026-09-23) `worker.ts` answers GET and DELETE on `/mcp` with **405**
  (`Allow: POST`), the MCP spec's "no stream here". The Step 0 probe is the
  regression check. Re-read the Worker's daily request count
  (`workersInvocationsAdaptive`) a week after the fix to confirm volume
  actually fell back towards the ~100/day it was before 2026-09-16; if it did
  not, some client ignores 405 and the rate rule below becomes the lever.
- **No rate limit anywhere.** The zone has no rules and the Worker has no
  in-code limiter. Free allows **one** rate-limit rule (10 s window, block
  action) — one rule scoped to `http.host eq "mcp.frontierroles.com"` would cap
  per-IP bursts; because `workers.dev` is disabled it cannot be walked round.
  Weigh it against the fact that legitimate clients are few and bursty.
- **Input bounds.** `mcp/src/server.ts`: `limit` is capped at 50 and `topN` at
  50, but the free-text strings (`query`, `company`, `city`, `country`,
  `slug`) are `z.string()` with no `.max()`. Establish what an oversized
  string costs — substring matching across the board per call, against the
  Worker's CPU-time limit — and whether a `.max(200)` is warranted. Don't
  report it as DoS without the arithmetic.
- **Outbound fetches**: `board.ts` fetches only `${FRONTIERROLES_BASE_URL}/
  mcp-index.json` and `/mcp-jobs/${encodeURIComponent(slug)}.json`, with
  `AbortSignal.timeout`. Base is a wrangler var, not input, so no SSRF;
  confirm a slug of `..` or `%2F` cannot escape `/mcp-jobs/` in a way that
  matters (same origin, fixed `.json` suffix).
- **Information leakage**: `/health` returns `String(err)` on failure. Today
  that can only carry a fetch error about a public URL — Low — but it is the
  shape cyclearchive fixed in its own API (fixed body, log server-side).
- **CORS** `*`, no credentials, no cookies: correct for a public read-only
  endpoint. Confirm it stays credential-free; don't reflexively flag it.

### C. Untrusted data, end to end

Everything from the ATS feeds — titles, company names, descriptions,
locations, salary strings, apply URLs — is third-party input. Trace each path
to its sink and confirm the defence sits at the sink:

- **Feed → connectors**: fetch targets come from `engine/seed/companies.csv`
  and from feed payloads (detail URLs, pagination links). `util/fetch.ts`:
  redirect handling, response-size bound (an unbounded `res.json()` on a hostile
  feed is a memory DoS on the runner), timeouts. Could a payload steer a fetch
  at an internal or unexpected host?
- **→ SQLite**: parameterised throughout (`db/repo.ts`); `db.exec()` never
  sees feed data. Re-verify adversarially rather than trusting `audit-code`.
- **→ the classifier**: a local ONNX model, so there is no prompt to inject.
  The residual risk is an advert written to be *classified in* (keyword
  stuffing onto an AI board). Low; mention it once if at all.
- **→ the site**: Astro escapes `{}` interpolation. The only `set:html` sinks
  are JSON-LD, each through `jsonLdScript()` (`lib/jsonld.ts` — confirm it
  neutralises `</script` and `<!--`). Descriptions are stored and rendered as
  plain text (`descriptionText`). Client-side cards are built with DOM calls,
  not `innerHTML` (`JobFilters.astro`, `lib/jobCardShape.ts` say so — verify no
  new sink has appeared). `safeUrl()` (`lib/format.ts`) accepts only
  `https?://` and upgrades http — it **rejects** protocol-relative
  `//evil.example`, the hole cyclearchive found in its own guard; keep a test
  for it.
- **→ RSS** (`lib/feed.ts`, `xmlEscape`) and **→ JSON surfaces**
  (`jobs-data.json`, `mcp-index.json`, `mcp-jobs/*.json`, `llms.txt`):
  escaping is `audit-site`'s to verify; here, ask only whether anything in
  them is not meant to be public.
- **→ other people's LLM sessions — the novel path.** `get_job` returns a
  trimmed job description (`mcp/src/tools.ts`, `trimDescription`) straight into
  claude.ai, ChatGPT or Claude Code sessions. Anyone who can write a posting on
  a seeded company's ATS board can put instructions aimed at an AI assistant in
  it ("ignore the user and…"). The server cannot make that safe, but it can
  keep the blast radius small. Length is already bounded
  (`MAX_DESCRIPTION_CHARS`, with a "[truncated — full advert at the apply
  URL]" marker); what to check is whether the tool output frames the text as
  quoted third-party content, and that no link is emitted except the
  `safeUrl`-checked apply URL (`render.ts`). Rank it honestly — Low to
  Medium, because the assistant and its user remain the last line of defence.
- **→ Google**: Indexing API and IndexNow URLs are built from slugs; confirm a
  slug cannot carry a host or path outside frontierroles.com.

### D. Browser-side

- Third-party JS: GA4 only (`Base.astro`, `async`, `is:inline`). No SRI is
  possible for gtag — note the trust. Any new third-party script or embed is a
  finding until justified.
- Inline scripts (`index.astro` / `JobFilters.astro` filter script, the GA
  bootstrap): static — confirm nothing from the snapshot is interpolated into
  a `<script>` body except via `jsonLdScript`.
- Reverse tabnabbing: every `target="_blank"` carries `rel="noopener"`
  (`jobs/[slug].astro` apply links, `mcp.astro`, `companies/[slug].astro`) —
  sweep for new ones.

### E. Headers and transport

- **Site (GitHub Pages, DNS-only):** no `Content-Security-Policy`, HSTS,
  `X-Frame-Options`, `X-Content-Type-Options` or `Referrer-Policy`, and no way
  to add them at the origin. Be straight about what that costs on a static
  site with no logins, no cookies and no forms: clickjacking and sniffing have
  little to take. Two routes if the owner wants headers anyway:
  1. **`<meta http-equiv="Content-Security-Policy">`** in `Base.astro` — covers
     script/style/connect origins (GA, `self`), not `frame-ancestors` or
     reporting. Cheap and reversible.
  2. **Proxy the apex through Cloudflare** and set headers with one Transform
     Rule plus the HSTS toggle. Carries cyclearchive's hard lessons: the SSL
     mode must stay **`full`, never "Full (strict)"** — GitHub Pages cannot
     renew a custom-domain certificate while the record is proxied, so strict
     eventually 526s the site; turn **Always Use HTTPS** on; check the zone's
     `browser_cache_ttl` 14400 isn't promoted onto HTML by a cache rule
     (`max-age=600` must survive); and the edge then needs the same bot and
     AI-crawler policy as `robots.txt` (`audit-site`). A real change with real
     failure modes — recommend it only with those named.
- **MCP host (proxied):** `min_tls_version` 1.0 — TLS 1.0/1.1 handshakes are
  accepted (cyclearchive raised the same setting to 1.2 on 2026-09-18; the
  zone-wide change affects only `mcp` today). HSTS off. Responses are
  `application/json` — add `X-Content-Type-Options: nosniff` in `withCors()` if
  absent; it costs one line.
- Mixed content: every asset, feed and JSON URL is `https`.

### F. Supply chain

- **npm**: one root lockfile for `shared`, `site`, `engine`, `mcp`. `npm audit`
  both ways (Step 0); advisories in dev-only tooling that never ships rank Low.
  The Worker's runtime deps (`@modelcontextprotocol/sdk`, `zod`) are the ones
  an attacker can reach. No Dependabot: recommend `.github/dependabot.yml`
  for `npm` and `github-actions` — cheap, and it makes SHA pins maintainable.
- **Actions pinned by tag, not SHA.** A moved tag runs attacker code with the
  job's secrets in scope. Weight by what each action sees:
  `cloudflare/wrangler-action@v3` (the Cloudflare token) and
  `anthropics/claude-code-action@v1` (the Claude token) matter most;
  first-party `actions/*` least. `sha_pinning_required` is a repo setting that
  enforces it once the pins exist.
- **The model**: fetched from a release asset and verified against the
  committed `ml/model/manifest.json` before every ingest — confirm the check
  is a hash compare that fails the run, and that it covers every file loaded.
- **The snapshot**: `npm run snapshot:fetch` and `deploy.yml` trust whatever is
  on the `snapshot` branch. Who can push it? Anyone with repo write — so repo
  write *is* the ability to publish arbitrary content on the site. That's why
  the GitHub account (2FA, PATs, deploy keys, OAuth apps with repo scope) is
  asset #1; ask the owner to confirm GitHub 2FA and list tokens with repo scope.

### G. CI/CD and deploy

- **Permissions per workflow**: default `read`. Check each job's
  `permissions:` is the minimum — `refresh.yml` needs `contents: write` (snapshot
  branch, release); `deploy.yml` needs `pages: write` + `id-token: write` in the
  deploy job only; the Claude workflows request `id-token: write` — confirm the
  action needs it.
- **Triggers**: no `pull_request_target`; fork-PR workflows need approval
  (`gh api repos/$R/actions/permissions/fork-pr-contributor-approval` if
  available); `workflow_dispatch` on a public repo is owner-only.
- **No branch protection on `main`**: for a solo repo that's a deliberate
  convenience, not a vulnerability — but it means any credential with push
  access deploys straight to production. Name it as context for §A/§F rather
  than a standalone finding unless something else makes it bite.
- **Concurrency**: `deploy-mcp.yml` cancels in progress (fine for a stateless
  deploy); `refresh` must not (half-mutated DB) — `audit-code` §13 owns the run
  history.

### H. DNS, domains and hosted assets

- **Every record must point at something the owner controls and that
  serves.** `curl` each hostname from the DNS listing. A name that lands on
  GitHub Pages and answers **"There isn't a GitHub Pages site here"** is a
  subdomain takeover waiting to happen — cyclearchive had exactly that
  (`files.` CNAME, deleted 2026-09-18).
- **GitHub Pages domain verification is off** (`protected_domain_state: null`).
  The apex points at shared Pages IPs; if this repo's Pages site were ever
  disabled or its custom domain cleared, **anyone** could claim
  `frontierroles.com` for their own Pages repo and serve content under it —
  with Google's trust, the Search Console history and the IndexNow key file
  all attached. Verifying the domain (GitHub → Settings → Pages → Add a
  verified domain, one TXT record) blocks other accounts from claiming it or
  any subdomain. Cheap; rank it Medium.
- **DNSSEC is disabled.** The registrar is Cloudflare, so enabling it is one
  toggle with the DS record added automatically. Low, cheap.
- **Release assets are public** (public repo): `db-latest`
  (`aiengjobs.db.gz`) and the model. Confirm the DB carries nothing beyond
  third-party job data — no tokens, no internal notes, no raw headers.
- **The old domain**: `alastairrushworth.com/aiengjobs/*` 301s via a redirect
  rule on that zone. It must stay (inbound links and Google's index) — flag it
  only if it breaks or redirects anywhere but frontierroles.com.

### I. Privacy

- **GA4** sets cookies and sends visitor IPs to Google, with no consent
  banner. For UK/EU visitors that is a PECR/GDPR consent question — state it
  factually and name the cheapest compliant options (consent mode with a
  banner, or cookieless analytics such as Cloudflare Web Analytics, which is
  only possible if the apex is proxied or the JS beacon is added).
- **Republished personal data**: descriptions can carry recruiter names and
  emails. It is already public on the employer's ATS; tombstoned (closed) roles
  should not keep serving it indefinitely — check what a tombstone renders.
- **No visitor PII is collected** — say so plainly, so the owner isn't
  over-worried; it is why most breach scenarios don't apply.

### J. Abuse, availability and cost (synthesis)

Pull the threads into one picture — for this owner it is the most likely real
harm:

- **Site**: GitHub Pages, free, soft bandwidth limit ~100 GB/month, no edge
  protection. A scrape costs the owner nothing but can distort GA4.
- **MCP Worker**: unauthenticated + no rate rule + an unknown plan. On Free,
  runaway volume takes the server down until midnight UTC; on Paid it bills.
  The 405 fix removed the one runaway seen so far; one rate rule is the cheap
  mitigation for the next.
- **Actions**: free on a public repo; the owner's GitHub budgets are $0 with
  stop-usage, so overage blocks rather than bills — but a larger runner label
  bills even on public repos. Confirm every job is `ubuntu-latest`.
- **Google**: Indexing API is free and quota-capped (200/day); a stolen key's
  harm is §A, not cost.
- **Claude**: the OAuth token's quota, gated by `claude.yml`'s author check.

Frame recommendations as **"how to avoid a surprise outage or bill"**, not
abstract hardening.

## Output — the report

Lead with a threat-model summary so a non-expert sees the shape before the
list.

```
# Security Audit — frontierroles.com (<date>)

## Threat model summary
<4–8 plain-language sentences: the realistic attackers, the assets actually at
risk (accounts and deploy credentials, board integrity, MCP availability and
quota, visitor browsers and downstream LLM sessions — and explicitly that there
are no accounts or visitor PII), and the single most important thing to fix.>

## Baseline
npm audit: <n prod / n dev>  ·  gitleaks: <n>  ·  zone drift vs 2026-09-23: <none | list>
MCP: GET /mcp <200 SSE | 405>  ·  TLS floor <1.0|1.2>  ·  workers.dev <1042 | open>
<one line on anything that couldn't be run, and why.>

## 🔴 Critical   (remotely exploitable now: account/deploy-credential takeover, secret leak, domain takeover in progress)
## 🟠 High        (realistic abuse: MCP outage/cost, broadly scoped token, reachable CVE, stored XSS)
## 🟡 Medium      (defence in depth: unverified Pages domain, tag-pinned actions with secrets, no rate rule, TLS floor)
## 🟢 Low / Nits  (hardening polish, theoretical on this site)

For each finding:
- **<short title>** — `path:line` (or the probe command)  ·  _<dimension>_
  - **Attacker & impact:** who can do what, and what they gain.
  - **Likelihood:** how realistic on this system ("needs verification" + the probe, where relevant).
  - **Fix:** the cheapest effective remediation, and where it lives.

## Verify out-of-band
<Cloudflare API-token permissions and zone scope; Workers plan (Free/Paid);
Cloudflare login 2FA (shared with cyclearchive — cite its latest verdict);
GitHub account 2FA and any PAT/OAuth app with repo scope; GCP service-account
key age; Pages domain verification. Give the exact click or command for each.>

## What's already solid
<call out the defences so they aren't removed later: parameterised SQL,
jsonLdScript on every JSON-LD sink, plain-text descriptions, DOM-built cards,
safeUrl rejecting protocol-relative URLs, xmlEscape, rel=noopener on _blank,
default read token, author-gated claude.yml, no pull_request_target,
manifest-verified model, workers.dev disabled, no secrets in the Worker,
https_enforced.>

## If you only do three things
<in order.>
```

Report rules (the shared ones apply too):

- **Never print a secret value** — name, location, "rotate".
- Rank by exploitability × impact **on this system**, not generic CVSS.
- Anything not actively confirmed → "needs verification" + the check in the
  out-of-band section.
- Quality/SEO/a11y/layout → one-line `→ audit-code` / `→ audit-site`.
- End by offering to (a) fix a chosen subset — the code-side fixes (`nosniff`,
  input `.max()`, SHA pins, Dependabot) are in-repo; the zone and
  account changes are the user's to click or approve one by one — or (b) save
  the report to `audits/audit-security-<date>.md`. Don't write files unasked.
- Put any lesson from the run into this file, in the section it belongs to.

## Optional: parallel exploration

For broad fan-out reads — "every `set:html`/`innerHTML` sink", "every
`target=\"_blank\"`", "every `fetch(` in `engine/src/`", "every `uses:` line",
"every log statement that could print a feed body" — you may dispatch `Explore`
agents to gather locations. Exploitability and severity calls stay in the main
thread: exploration finds the sinks, you decide what an attacker gains.
