---
name: audit-code
description: Run a thorough, deep-thinking code-quality audit of the whole aiengjobs codebase — correctness, security, type safety, simplicity, duplication, readability, modernness/idiom, error handling, testing, dependencies, performance, architecture, tooling/CI hygiene, and the health of recent GitHub Actions runs. Use when the user asks to audit, review, or sanity-check the code (as opposed to the rendered site) — "review the code", "code quality audit", "is this codebase well written", "how is CI doing", "are the nightly runs healthy", or a deep pass over a subsystem. Covers all source in the repo: engine/ (connectors, pipeline, db, export, notify), shared/, mcp/ (the MCP server and its Worker), site/src/ as source, tests/, scripts/, ml/, and .github/workflows/ — both as files and as their actual run history on GitHub. Rendered-output concerns (SEO, structured data, a11y, responsive layout, on-page UX copy) belong to the audit-site skill; the adversarial whole-system security pass (secret scope, the live MCP server, DNS, Cloudflare, abuse and cost) belongs to audit-security; whether the published data is right role by role belongs to audit-data. For a full sweep across source, rendered output and UI together, use audit-all instead. Produces a prioritized findings report; read-only by default (does not edit files unless asked).
---

# Code Audit — aiengjobs

**Read `.claude/audit-conventions.md` first.** It carries the rules shared by
all the audit skills — the scope split, operating rules, the data boundary,
known non-issues, severity tiers and report rules. This file adds only what's
specific to auditing source.

A deep, systematic review of the codebase **as code**: is it correct, secure,
honest about its types, simple, readable, modern, tested, and maintainable by
someone returning to it in six months. Think hard. Favour thoroughness over
speed — this skill is meant to be run occasionally and take its time.

Surface both **big-picture** concerns (module boundaries, the engine↔site
contract, where complexity is accumulating, what breaks at 10× scale) and
**small-scale** ones (a swallowed error, a duplicated helper, a misleading
variable name, an `as` cast papering over a real shape mismatch).

## Scope boundary

This skill owns **every line of source in the repo**, judged as code:

- `engine/src/` — CLI, config, 15 ATS connectors, the pipeline (`normalize`,
  `classify` + `encoder` (local ONNX), `tag`, `comp`, `location`, `region`,
  `seniority`, `hash`), `db/` (node:sqlite), `export/`, `notify.ts` and
  `googleIndexing.ts`, `seed.ts`, `retag.ts`, `relocate.ts`, `logos.ts`,
  `util/`
- `shared/` — `types.ts`, `taxonomy.ts`, `text.ts`, `city.ts`, `fx.ts`,
  `indexable.ts` and the package-exports surface the workspaces consume
- `mcp/` — the MCP server: tools, rendering and board loading shared by the
  stdio entry point and the Cloudflare Worker (`worker.ts`, `wrangler.jsonc`)
- `site/src/` **as source** — `lib/` helpers (landing/pagination logic in
  `landings.ts`, the RSS builder in `feed.ts`, `jobsPayload.ts`, the
  build-time derivations `postingFacts.ts`, `payBenchmark.ts`,
  `companyHiring.ts`, the OG card renderer in `og/`), page front-matter logic,
  component structure, inline `<script>` blocks, `global.css` organisation
- `ml/` — the TypeScript and Python tooling around the classifier
  (`evaluate.ts`, `acceptance/run.ts`, `train_encoder.py`, …) as code; the
  training decisions themselves belong to `ml/README.md`
- `tests/` — the vitest suite: what it covers, how well, and what it misses
- `scripts/refresh.sh` — the nightly ingest/export/push script
- `.github/workflows/` — refresh, deploy, deploy-mcp and the two Claude
  workflows, judged both as files **and as their recent runs on GitHub** (§13)
- Workspace plumbing: root/`site`/`engine`/`shared`/`mcp` `package.json`,
  `tsconfig.json`s, `.gitignore`, `astro.config.mjs`

It does **not** cover, because `audit-site` owns them: SEO and JSON-LD
correctness, Google for Jobs eligibility, sitemap/robots/canonical strategy,
accessibility, responsive rendering across viewports, on-page copy and UX, and
rendered-output inspection of `site/dist/`. The adversarial whole-system pass
— secret scope, the live MCP server, DNS, the Cloudflare account, live headers
and TLS — is `audit-security`'s; whether the data a stage produces is *right*,
role by role, is `audit-data`'s. See the split table in the shared conventions.

So: a duplicated helper across pages, a swallowed error in an inline script, an
unsound cast, an unescaped interpolation in `lib/feed.ts` — yours. Whether the
resulting page ranks, renders, or reads well — audit-site's.

## Operating rules

The shared rules in `.claude/audit-conventions.md` apply in full — read-only by
default, cite `file:line`, read the comments before flagging, the known
non-issues list, no drive-by rewrites, taste vs defect. On top of those, three
that bite hardest in a source audit:

- **The untrusted-input path is the main event.** Feed data reaching SQL, the
  classifier, the snapshot, rendered HTML and the MCP server's output is the
  single most important review surface in this repo — §2 is where the audit
  earns its keep.
- **Data defects are pipeline defects.** Never propose hand-edits to
  `snapshot.json`; trace to the stage that produced the value.
- **Restructuring goes in §11, once.** If a subsystem genuinely needs
  reshaping, say so there with the concrete pain it removes — not sprinkled
  through the findings.

## Step 0 — Establish the baseline

Before reasoning about source, find out what the toolchain already knows.

```bash
npm run typecheck                    # engine + astro check + mcp + root tsc
npm test                             # vitest run
npm run build -w @aiengjobs/site     # catches template + import errors
```

Then find out what **CI** already knows — the same toolchain, run for real:

```bash
gh run list --limit 40 \
  --json databaseId,workflowName,event,status,conclusion,headBranch,createdAt,startedAt,updatedAt
gh workflow list --all
```

Notes:
- The site build needs the snapshot — see Prerequisites in the shared
  conventions. Say so in the report if you couldn't build.
- Treat **every** warning as a candidate finding, not noise.
- Record the numbers you'll reason about later: build time, test count, source
  line counts per area, largest files, and per-workflow pass rate and duration.
- Check the working tree: `git status`, and `git log --oneline -20` for recent
  direction. Uncommitted work in progress changes what's fair to flag — mention
  it rather than reviewing half-finished code as if it shipped.
- If `gh` is missing or unauthenticated (`gh auth status`), skip §13 and say so
  in the report — don't guess at run health from the workflow files.

## Review dimensions

Work through every dimension. For each, note what's *correct* as well as what's
wrong — a clean dimension is a useful result. If a dimension doesn't apply to an
area, say so briefly rather than padding.

### 1. Correctness & robustness

The bugs that survive typechecking.

- **Edge inputs at every boundary.** A feed returning `[]`, a 404 board, a
  malformed JSON payload, a job with no description/salary/location, an unknown
  currency, an unknown country code, a `postedAt` that's absent or in the
  future, a duplicate ID across two ATS platforms. What happens — a sane default,
  a crash, or a silently wrong value written to the DB?
- **Off-by-one and boundary logic** in pagination, `slice`, date arithmetic,
  the classifier's decision points (`ENCODER_THRESHOLD`,
  `ENCODER_VETO_CONFIDENCE` and the heuristic-IN/veto branch in `ingest.ts`),
  the age and unseen cut-offs (`MAX_JOB_AGE_DAYS`, `UNSEEN_CLOSE_DAYS`), and the
  "new"/"closed"/`validThrough` day calculations. Check timezone handling —
  is everything UTC, consistently?
- **Idempotency.** `seed()` upserts and `refresh` re-runs nightly. Is every
  stage genuinely safe to re-run? What about a run that dies halfway — partial
  DB state, a half-written snapshot, a `notify` that fires twice?
- **Concurrency.** `util/concurrency.ts` and its use across connectors: bounded
  parallelism, no unhandled rejections, no shared mutable state raced between
  tasks, per-host limits on detail fetches (Workable throttles per IP after
  ~150), and bounded encoder inference.
- **Numeric and string handling.** Salary parsing (`pipeline/comp.ts`), FX
  conversion (`shared/fx.ts`) — rounding, integer vs float, currency-unit
  mismatches (hourly vs annual), locale-formatted numbers from feeds.
- **Regex correctness** in `config.ts` (IN/OUT title patterns), `tag.ts`,
  `location.ts`, `comp.ts` and `site/src/lib/postingFacts.ts` (which runs
  dozens of patterns over every full description at build time): unanchored
  patterns matching substrings they shouldn't, catastrophic backtracking on
  long untrusted strings, missing word boundaries, case sensitivity.
- **HTML/entity handling** in `util/html.ts` and `shared/text.ts` — the classic
  source of mangled titles. Consistent decode-once semantics, no double-decode,
  no half-stripped markup.
- **Dead-end control flow:** `catch` blocks that swallow, `?? ""` defaults that
  hide a missing field rather than surfacing it, `continue` that drops a record
  without a log.

### 2. Security (source level)

`audit-security` owns the adversarial, whole-system pass — secret *scope*, the
live MCP server, DNS, the Cloudflare account, headers, abuse and cost. This
section asks the source-level question: **is each guard implemented
correctly?** Keep it to that; route anything about the deployed system as a
one-line `→ audit-security`. The threat model is still **untrusted third-party
feed data flowing into a database, a classifier, a published snapshot, a
public site and an MCP server.**

- **Injection into SQL.** Every statement in `engine/src/db/repo.ts` and
  `db/index.ts` must be parameterized (`?` placeholders, `prepare().run()`), with
  no string-interpolated values. Check table/column names aren't built from
  input. Note that `node:sqlite`'s `DatabaseSync` has its own gotchas —
  `db.exec()` takes raw SQL and must never see feed data.
- **Classifier inputs.** There is no prompt: `encoder.ts` scores raw title,
  company, location and description through a local ONNX model, and
  `trainInferenceParity.test.ts` pins those inputs to what the model was
  trained on. Check the text is bounded before tokenisation, that the model
  files are verified against `ml/model/manifest.json` before use (a hash
  compare that fails the run), and that an inference failure throws rather than
  silently classifying.
- **MCP tool inputs and output** (`mcp/src/server.ts`, `tools.ts`,
  `render.ts`): zod schemas bound every numeric argument — do the free-text
  ones need a `.max()`? Descriptions are trimmed to `MAX_DESCRIPTION_CHARS`;
  the apply URL goes through a `safeUrl`-style check before it is rendered.
- **Outbound request safety.** Connectors fetch URLs derived from
  `engine/seed/companies.csv` and from feed payloads. Are fetched URLs
  constrained to expected hosts/schemes, or could a feed redirect the engine at
  an internal address (SSRF)? Check `util/fetch.ts`: timeouts (present), retry
  bounds (present), **redirect handling**, response size limits (an unbounded
  `res.json()` on a hostile feed is a memory DoS), and whether error bodies get
  logged verbatim.
- **Secrets in source.** Classification is local, so no LLM key should exist
  anywhere — no `OPENAI_API_KEY` or similar in code, workflows or docs.
  `.env` is gitignored and `engine/.env.example` holds placeholders. The CI
  secrets that *do* exist (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `GOOGLE_INDEXING_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`) must be read only where
  they're needed and never logged — check `googleIndexing.ts` and the notify
  path in particular. Their *scope* and blast radius → `audit-security`.
- **What the export leaks.** `export/exportSnapshot.ts`, and the site's JSON
  endpoints (`jobs-data.json`, `mcp-index.json`, `mcp-jobs/*.json`) decide what
  becomes world-readable. Confirm nothing internal (raw feed payloads, internal
  scores or ids that aren't meant to be public, company contact data) ships
  that shouldn't.
- **Front-end injection.** Untrusted strings rendered via `set:html`, into
  JSON-LD, or into `href`s — verify `jsonLdScript()` and `safeUrl()` are used
  everywhere they must be, and that `safeUrl` actually rejects `javascript:` and
  `data:`. (Correctness of the *guards* is yours; whether the resulting page is
  SEO-valid is audit-site's.)
- **Shell and ops.** `scripts/refresh.sh`: unquoted expansions, `eval`,
  `set -euo pipefail` (present) vs the `|| true` escapes that intentionally
  bypass it — is each one deliberate and safe? The `git push --force` to
  `refs/heads/snapshot` — can it ever target the wrong ref?
- **CI workflow files.** `permissions:` scoped to the minimum per job, no
  `pull_request_target` with an untrusted checkout, the `author_association`
  gate in `claude.yml` covering every trigger. Tag-vs-SHA pinning and what each
  action can reach → `audit-security` §F.
- **Dependency risk** — see §9.

### 3. Types & contracts

- **Type honesty.** Hunt `any`, unchecked `as`, non-null `!`, and
  `@ts-ignore`/`@ts-expect-error`. Each one is a claim the compiler couldn't
  verify: is the claim actually true, and is it confined to a real boundary
  (JSON parse, DB row, feed payload) or leaking into normal code?
- **Validate at the edges.** Feed JSON, MCP tool arguments, DB rows and the snapshot
  all enter as `unknown`-shaped data. Is each parsed/narrowed once at its
  boundary, or cast optimistically and trusted downstream?
- **The engine↔site contract.** `shared/types.ts` should be the *only* interface.
  Check for drift between `types.ts`, what `exportSnapshot.ts` actually writes,
  and what `site/src/lib/data.ts` assumes. Silent schema drift here is the
  classic failure mode: it typechecks on both sides and still breaks.
- **Modelling quality.** Optionality that should be a discriminated union
  (open vs closed jobs); stringly-typed values that should be literal unions
  (cluster ids, seniority, employment type, currency); `string | undefined`
  where the code always requires a value. Are the taxonomy types in
  `shared/taxonomy.ts` derived from the data rather than duplicated by hand?
- **Strictness configuration.** Both tsconfigs are strict — confirm, and check
  whether the stricter flags not implied by `strict` (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`) would catch real bugs here.
  Recommend only with a concrete example.

### 4. Simplicity

- **Duplication that matters.** The same logic in two places that must change
  together: salary/stat computation across pages, JSON-LD assembly, job-list
  rendering, date formatting, slug construction, cluster filtering. Also
  cross-workspace duplication — a helper reimplemented in `site/src/lib/` that
  already exists in `shared/`.
- **Connector duplication vs. connector clarity.** 15 connectors will share
  shape by nature. Judge carefully: which repetition is genuine boilerplate that
  a shared helper should absorb (pagination, error handling, field mapping), and
  which is per-ATS specificity that a premature abstraction would make *worse*?
  Say which, explicitly — don't reflexively call for a base class.
- **Over-engineering.** Abstractions with one caller, options never passed,
  configurability nobody uses, indirection that costs more than it saves.
- **Function and file size.** Measure (`wc -l` over `engine/src`, `site/src`,
  `mcp/src`, `shared` — the big ones move every month; `jobs/[slug].astro` has
  passed 650 lines) and flag the long ones only where length reflects tangled
  responsibility — and name the seam where they'd split.
- **Dead code.** Unused exports, unreachable branches, leftover scaffolding,
  helpers with zero callers, commented-out blocks, stale CSS. Verify with a
  repo-wide grep before claiming something is unused.
- **Nesting and control flow.** Deep conditionals that early returns would
  flatten; boolean parameters that should be two functions; long `if/else`
  chains better served by a lookup table (several of the pipeline stages are
  natural candidates — check whether they already do this).

### 5. Readability

- **Naming.** Do names say what the thing *is*? Watch for vague (`data`, `res`,
  `tmp`, `x`), inconsistent vocabulary for one concept (job/posting/role/listing;
  company/org/employer; cluster/topic/tag/skill — this repo uses several, check
  they're distinct concepts and not synonyms), and abbreviations that only make
  sense to the author.
- **Comment quality.** This codebase comments *why*, which is the right habit.
  Check for: comments that now contradict the code (dangerous), comments
  restating the obvious (noise), and complex logic with **no** explanatory
  comment — especially the classification heuristics, confidence thresholds,
  and anything with a tuned magic number.
- **Magic values.** Numbers and strings with meaning but no name — retry counts,
  timeouts, truncation lengths, page sizes, day thresholds, score cutoffs.
  Named constants in `config.ts` are the established pattern; find the ones that
  escaped it.
- **Consistency.** Import ordering and style, error-message format, log prefixes
  (the engine's `  ! ` warning prefix — is it used uniformly?), async style (`async/await` vs `.then`),
  export style (named vs default), file naming, JSDoc presence on public helpers.
  Inconsistency here is cheap to fix and pays back every read.
- **Cognitive load.** Which file would be hardest for a competent stranger to
  pick up cold, and what one change would most reduce that? Answer concretely.

### 6. Modernness & idiom

Modern where it buys something — not novelty for its own sake.

- **Runtime.** Node 24 (per CI) with `node:sqlite`, `AbortSignal.timeout`,
  native `fetch`. Check for hand-rolled utilities that a modern built-in now
  covers: `structuredClone`, `Array.prototype.at/findLast/toSorted/flatMap`,
  `Object.groupBy`/`Map.groupBy`, `Intl.NumberFormat`/`Intl.DateTimeFormat` for
  currency and dates, `URL`/`URLSearchParams` instead of string surgery,
  `AbortController`, `Promise.allSettled` where partial failure is expected.
- **Language.** ES2023 target: `??`/`?.`/`||=`, `satisfies` (often better than
  `as` at config boundaries), `const` type parameters, template literal types
  for slugs/ids. Flag genuinely dated patterns — but note that `node:sqlite`'s
  API is *synchronous by design*, so sync DB calls are correct, not legacy.
- **Astro 5 idiom** (as code, not as output): content collections vs. hand-rolled
  data loading, `getStaticPaths` typing, `Astro.props` typing, component
  boundaries, whether inline `<script>` blocks should be `src/scripts/` modules.
- **Deprecations.** Anything using a deprecated API, an experimental Node flag,
  or a pattern the ecosystem has moved off. Check `node:sqlite`'s stability
  status against the pinned Node version — an experimental-API change is a real
  upgrade risk worth naming.
- **Don't churn.** Only recommend a modernisation with a stated benefit:
  fewer lines, fewer bugs, less to maintain, better types.

### 7. Error handling, resilience & observability

The engine runs **unattended nightly on a GitHub Actions runner** — nobody is
watching the log. That framing decides most calls in this section.

- **Failure taxonomy.** For each stage, what's fatal vs. recoverable? One dead
  ATS feed must not kill the run; a corrupt DB write should. Check that the code
  actually distinguishes them rather than wrapping everything in one try/catch.
- **Swallowed errors.** `catch {}`, `catch (e) { return null }`, `.catch(() => "")`,
  `|| true` in the shell script. Each is a deliberate degradation *or* a silent
  bug. Two documented contrasts to check still hold: encoder inference
  **throws** and fails the run (`ingest.ts` — no silent heuristic fallback),
  while `notify` is non-fatal. And the one that bit: `fetchRetry` *returns* a
  429 that outlasts its retries rather than throwing, so a Workable 429 storm
  once looked like success with empty descriptions, flipped every content hash
  and re-inferred a whole board nightly. Look for other callers that treat a
  non-throwing failure as data.
- **Partial-failure visibility.** If 3 of 40 boards fail, does the run report it,
  and does the exporter still publish? Is there any threshold ("more than half
  the feeds failed — don't publish") guarding against publishing a gutted
  snapshot? That's a data-integrity question, not just a logging one.
- **Logging quality.** Enough context to debug tomorrow morning (which company,
  which URL, which stage), no secrets, no unbounded dumps of feed bodies,
  consistent prefixes, sensible `console.warn` vs `.error` vs `.log`. Is there a
  run summary — counts in/out/new/closed/errors?
- **Exit codes.** Does `cli.ts` exit non-zero on real failure so the workflow
  step is marked failed? Trace `refresh` and `notify` through `refresh.sh` and
  check the exit status survives the pipe/`||` chain. Watch for steps guarded by
  `if: success()` — publishing the DB on a failed run poisons every later one.
- **Retries and rate limits.** `fetchRetry` handles 429 + timeouts; check
  `Retry-After` is respected and that per-host concurrency won't get the bot
  blocked. It does **not** retry 403 or 5xx, and notify's delta is
  previous-vs-next snapshot only — so a failed IndexNow or Indexing API night
  is never re-sent. Decide whether that is acceptable, per endpoint.
- **Recovery.** After a failed nightly run, does the next one self-heal?

### 8. Testing

- **Map coverage against risk.** Derive the map fresh: `ls tests/` against the
  source modules (about 40 test files on 2026-09-23, covering most of the
  pipeline, several connectors, the MCP layer and many site `lib/` helpers).
  The finding is what is *untested and risky* — likely candidates are the
  connectors without a test file, `seniority.ts`, the classification branch in
  `ingest.ts` end to end, and page front-matter logic that isn't in `lib/`.
  Rank the gaps by (likelihood of breaking × cost of breaking silently), and
  name the 3–5 tests that would buy the most safety.
- **Test quality, not just count.** Do existing tests assert real behaviour or
  restate the implementation? Do they cover edge cases and failure paths, or
  only the happy path? Are they deterministic (no wall-clock, no network, no
  ordering assumptions)? Would they *fail* if the code broke — try to imagine a
  plausible bug each test would miss.
- **Testability as a design signal.** Code that's hard to test usually has a
  boundary problem: network/DB/model calls fused into logic. Point at the specific
  seam that would make a risky module testable.
- **Fixtures.** Are connector responses and encoder scores fixture-able, or would
  each test need the network? Suggest the lightest workable approach.
- **CI wiring.** `npm test` runs in the `check` job — confirm it can actually
  fail the deploy, and that nothing important is excluded from the vitest run.

### 9. Dependencies & supply chain

- **Inventory.** The dependency surface is deliberately small — `astro`,
  `@astrojs/check`, `tsx`, `typescript`, `vitest`, `@types/node`, `onnxruntime-node`
  and `@huggingface/transformers` for the encoder, and in `mcp/`
  `@modelcontextprotocol/sdk`, `zod` and `wrangler` (dev). Re-list it from the
  `package.json`s rather than trusting this line. Treat the minimalism as a
  feature to preserve; any new runtime dependency deserves justification.
  `ml/`'s Python tooling is outside npm and runs only on a training box.
- **Currency and health.** `npm outdated` and `npm audit` at the root. Report
  majors behind, known vulnerabilities (with real exploitability in *this*
  context — a devDependency advisory that can't reach production is Low), and
  anything unmaintained.
- **Version discipline.** `^` ranges vs the committed lockfile; CI uses
  `npm ci` (good) — confirm the lockfile is committed and in sync
  (`npm ci` failing on drift is the canonical symptom).
- **Node version.** CI pins Node 24 in each workflow independently, and a local
  clone uses whatever the developer has. Flag the absence of a shared pin
  (`engines`, `.nvmrc`) if it's a genuine drift risk given `node:sqlite`'s
  stability status.
- **Workspace wiring.** `shared` is consumed as a source-only package via
  `exports` with no build step. Verify each export path resolves for *both* tsx
  (engine) and Astro (site), and that nothing imports across a workspace
  boundary by relative path instead of package name.

### 10. Performance & scalability

Correctness first, but this pipeline grows monotonically.

- **The nightly run.** Where does wall-clock actually go — feed fetching,
  encoder inference (seconds per advert, fp32, 3072-token window), DB writes,
  export? Is concurrency bounded sensibly? How does runtime scale as
  `companies.csv` grows 5×? Is there anything O(n²) over the job set?
- **Inference volume.** Is inference bounded by *changed* adverts (the content
  hash) or by *all* of them? A change that flips every hash — a new
  normalisation, a feed returning empty descriptions — re-infers the whole
  board and eats the 300-minute timeout. Check the guard exists and what
  defeats it.
- **Database.** Indexes in `schema.sql` matching the actual query patterns in
  `repo.ts`; N+1 query loops; transactions around bulk writes (WAL is on, but a
  per-row implicit transaction on thousands of rows is slow); statement reuse.
- **Memory.** Anything loading the full job set (with descriptions) into memory
  at once — the exporter, retag, reclassify. At 10× jobs, does it still fit?
- **Snapshot size.** ~22MB today, published on a detached branch precisely
  because of growth. What's the trajectory, and what breaks first — the git
  push, the CI fetch, the Astro build, or the browser?
- **Build time.** Note the current site build time and what drives it.

### 11. Architecture & boundaries

- **Layering.** Is the flow clean — connectors → normalize → classify/extract →
  tag/comp/location → db → export → site — or do stages reach across each other?
  Does anything in `pipeline/` know about HTTP, or anything in `connectors/`
  know about the DB?
- **`shared/` discipline.** Is it genuinely shared, or a dumping ground? Does
  anything in it depend on engine-only or site-only concerns?
- **Single source of truth.** The taxonomy (`shared/taxonomy.ts` ↔
  `site/src/lib/clusters.ts`), site origin/base (`engine/src/config.ts` ↔
  `astro.config.mjs` ↔ `site/src/lib/url.ts`), brand strings, currency data.
  Each duplicated constant is a future inconsistency — find them all.
- **Coupling to externals.** How much would it cost to add a 16th ATS
  connector, ship a retrained classifier, or move off SQLite? If a
  connector-shaped change requires edits in five unrelated files, that's the
  finding.
- **Configuration vs. code.** Tuning knobs (thresholds, patterns, model name)
  centralized in `config.ts` and overridable by env — is that consistent, and is
  anything hardcoded that operationally needs to change without a deploy?
- **The ops story.** `refresh.yml` cron → `refresh.sh` → engine → git push →
  Pages build, with the DB carried between runs by the Actions cache and the
  `db-latest` release asset. Where are the single points of failure, what's the
  manual recovery path, and is it documented well enough to follow at 2am?
- **Scale-out thinking.** What structurally breaks at 10× companies — not
  performance (§10) but *design*: the one-SQLite-file model and its 6-hour job
  timeout, the full-snapshot-every-night model, the no-queue model.

### 12. Tooling, CI & deploy hygiene

- **Workflow correctness.** `deploy.yml` runs `check` and `build` as independent
  jobs that each fetch the snapshot and `npm ci` — is the duplicated work worth
  the parallelism, and can a deploy proceed if `check` is skipped rather than
  passed? Verify `needs:` actually gates.
- **Workflow safety** — triggers, `permissions:`, secret exposure, action
  pinning (see §2).
- **Reproducibility.** Can a fresh clone get to a working state from the README
  alone? Try the documented path (`npm ci`, `npm run snapshot:fetch`,
  `npm run build`) and report where it diverges from the docs.
- **Scripts.** Root and per-workspace `package.json` scripts: any missing
  (`lint`? `format`?), any broken, any that only work in CI.
- **Docs as code.** `README.md`, `spec.md`, `ml/README.md`, `mcp/README.md`,
  `engine/.env.example` — are they still accurate? Documentation that lies is
  worse than none; call out specific stale claims with a line reference.

### 13. Live CI health — recent workflow runs

§12 reads the workflow *files*. This reads what actually happened when they ran.
It is the only dimension that can catch the failure mode this project is most
exposed to: **the nightly refresh quietly stops working and nobody notices**,
because nobody is watching a 23:10 UTC cron on a runner.

**Read-only, always.** Inspect runs; never change them. Do not
`gh run rerun`/`cancel`/`delete`, `gh workflow enable`/`disable`/`run`,
`gh cache delete`, or `gh release delete` — not even to "test a theory". If a
re-run would settle a question, say so as a recommendation and let the user do
it.

Cover roughly the last **30 runs or 14 days**, whichever is wider. The tools:

```bash
gh run list --limit 40 --json databaseId,workflowName,event,status,conclusion,headBranch,createdAt,startedAt,updatedAt
gh run list --workflow "Nightly refresh" --limit 20 --json databaseId,event,conclusion,startedAt,updatedAt
gh run view <id> --json jobs -q '.jobs[] | {name, conclusion, startedAt, completedAt, steps: [.steps[] | select(.conclusion == "failure") | .name]}'
gh run view <id> --log-failed | tail -80        # the actual error, not a guess
gh api repos/{owner}/{repo}/actions/runs/<id>/timing
gh cache list --limit 20                        # 10GB repo budget, 7-day eviction
gh release view db-latest --json assets,publishedAt
gh api repos/{owner}/{repo}/actions/workflows -q '.workflows[] | [.name, .state, .path] | @tsv'
```

Work through:

- **Pass rate per workflow.** Group the runs and give each an honest rate
  (`Nightly refresh: 4/9`). A workflow that fails a third of the time is broken
  even if the last run was green — intermittent failure that self-heals still
  means missed nights of ingest.
- **Did the cron actually fire?** `refresh.yml` is `cron: "10 23 * * *"`. Count
  the `event: schedule` runs over the window: 14 days should mean ~14 runs.
  GitHub delays and silently **drops** scheduled runs on public repos under
  load, and disables the schedule entirely after 60 days of repo inactivity.
  Compare `createdAt` against 23:10 UTC — delay is the norm rather than the
  exception here, and has historically run to two or three hours, so drift
  alone is not a finding; a missing day is. If the delay has grown enough that
  the board is no longer rebuilt by UK morning, that is worth raising. Note that `workflow_dispatch` runs are
  manual repairs, not evidence the schedule works.
- **Triage every failure to a step, from the log.** For each failed run, name
  the job, the step, and the real error (`--log-failed`). Then classify:
  transient (a feed 5xx, a rate limit, a runner hiccup) versus a genuine
  regression. **The same step failing repeatedly is a finding regardless of
  which bucket it lands in** — recurring "transient" failure is an unhandled
  case in `fetchRetry` or `refresh.sh`, not bad luck.
- **Duration and the timeout.** `refresh` has `timeout-minutes: 300`. Chart
  wall-clock (`startedAt` → `updatedAt`) across runs: is it trending up as
  `companies.csv` grows, and what fraction of the budget does the worst run use?
  A run that burns hours and *then* fails is the expensive shape — it holds the
  `refresh` concurrency group the whole time. Cross-reference §10.
- **Green-but-empty runs.** A `success` conclusion proves nothing if the work
  was skipped. Check for jobs that succeeded with every meaningful step skipped,
  `conclusion: skipped` runs treated as passes, and — most important here —
  whether `deploy` actually ran. `deploy` is `needs: refresh`, so a failed
  refresh skips the publish: the site keeps serving the last snapshot with no
  red X anywhere on `main`. Tie this to the snapshot-freshness check in the
  shared conventions: if `generatedAt` is stale, the run history says why.
- **Warnings on green runs.** `refresh.yml` emits
  `::warning::no database found — initialising a fresh one. Every job will look
  new.` — a run can be green while having thrown away all the state. Scan
  successful runs for annotations (`gh run view <id> --log | grep -E '::(warning|error)'`),
  and treat that particular one as 🔴 if it ever fired.
- **Cancellations and the queue.** `concurrency: {group: refresh,
  cancel-in-progress: false}` exists because a cancelled run can leave the DB
  half-mutated. Look for `cancelled` conclusions, and for runs that sat queued
  behind a long one — overlapping nightlies mean the schedule is slower than its
  period.
- **The state carried between runs.** `db-latest`'s asset size and
  `publishedAt` should advance on every successful refresh; a flat or shrinking
  size means ingest is producing nothing. In `gh cache list`, confirm the
  `aiengjobs-db-` and `encoder-` entries exist and are being refreshed — the DB
  cache evicting after 7 days is the designed fallback path to the release, so
  check the "Download database from release" step is exercised and works.
- **Registered vs. committed workflows.** Compare `gh workflow list --all` to
  the files on `main`. An `active` workflow with no file — typically a temporary
  one merged from a feature branch and never cleaned up — still holds
  permissions and can still be dispatched. Likewise flag `disabled_manually`
  workflows nobody meant to leave off, and files on `main` that have never run.
- **Runner labels and cost.** `refresh.yml` warns that larger runner labels are
  billed even on public repos. Confirm every job actually ran on
  `ubuntu-latest`, and sanity-check overall consumption if
  `gh api .../actions/runs/<id>/timing` reports non-zero billable ms.
- **Bot workflow behaviour.** `claude.yml` and `claude-code-review.yml` run on PR
  and comment events. Check they aren't firing on every push in a loop, aren't
  running on fork PRs with write permissions, and aren't quietly failing (a
  review bot that errors on every PR is dead weight the team stops noticing).

Findings here are about the *code and config that produced the runs* — a missing
guard, an unbounded retry, a step ordering that publishes bad state. If the fix
is in a workflow file or in `scripts/refresh.sh`, it belongs to this audit.
Purely operational one-offs ("re-run the failed job") are a recommendation, not
a finding.

## Output — the report

Present findings in the conversation as a prioritized report:

```
# Code Audit — aiengjobs (<date>)

## Summary
<4–8 sentences: overall health, the strongest and weakest areas, the biggest
recurring themes, and the single most important fix.>

## Baseline
typecheck: <pass/fail>  ·  tests: <n passed>  ·  build: <pass/fail, time>
CI (last <n> runs): <per-workflow pass rate>  ·  last nightly: <date, conclusion>
<one line on anything that couldn't be run, and why.>

## Health by area
| Area | Verdict | Notes |
|------|---------|-------|
| engine/connectors | ✅ / ⚠️ / ❌ | one line |
| engine/pipeline   | | |
| engine/db + export| | |
| shared/           | | |
| site/src (as code)| | |
| tests/            | | |
| scripts + deploy  | | |
| CI (workflow files)| | |
| CI (recent runs)  | | pass rate, cron reliability, duration trend |

## 🔴 Critical   (data corruption, security, silent failure in production)
## 🟠 High       (real correctness/maintenance risk; fix soon)
## 🟡 Medium     (quality, clarity, duplication, test gaps)
## 🟢 Low / Nits (polish and preferences — labelled as such)

For each finding:
- **<short title>** — `path:line`  ·  _<dimension>_
  - What & why it matters (concrete failure mode or maintenance cost)
  - Recommended fix (smallest change that resolves it)

## What's already good
<brief — call out the solid patterns worth preserving so they don't get
"fixed" later.>

## If you only do three things
<the three highest-leverage changes, in order.>
```

The shared report rules apply (one finding per issue, a pattern reported once
with all its locations, honest uncertainty, `→ audit-site` / `→ audit-ui`
one-liners, offer to fix or save — never write files unasked). Specific to this
audit:

- Tag each finding with its dimension number so themes are visible.
- Runtime behaviour you couldn't exercise — live feeds, classifier output on
  real adverts — gets "needs verification" rather than a confident claim. Past
  nightly runs are an exception: §13 gives you the real logs, so cite the run
  (`run <id>, <date>`) and state what failed rather than hedging. What you still
  can't know is whether *tonight's* run will behave differently.
- Save target: `audits/audit-code-<date>.md`.

Parallel `Explore` fan-out is available for broad location-gathering ("every
`catch` block in `engine/src/`", "every `as` cast", "every `console.*` call",
"every constant duplicated across workspaces") — see the shared conventions.
