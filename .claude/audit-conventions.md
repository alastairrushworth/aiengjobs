# Audit conventions — aiengjobs

Shared ground rules for the `audit-code`, `audit-site`, `audit-ui`,
`audit-security` and `audit-data` skills. Every audit skill reads this file
first, then applies its own scope, review dimensions and report skeleton on
top.

Edit this file to change how **all** the audits behave. Anything that is true of
only one audit belongs in that skill's `SKILL.md`, not here.

**Lessons live in the skills.** When a run teaches something — a probe that
lied, a baseline that moved, a false positive nearly reported — write it into
the `SKILL.md` (or this file, if it holds for every audit) in the same change
as the fix. A lesson that only lives in a conversation is relearned next time.

---

## The split

One repo, one site, five lenses. Each skill owns one column and stays out of
the others'.

| Question | Skill |
|---|---|
| Is the **source** correct, simple, readable, typed, tested? | **audit-code** |
| Is the **output** correct, discoverable, accessible, fast, unbroken? | **audit-site** |
| Does it **look and feel** considered? Where's the friction? | **audit-ui** |
| What can an **attacker** do to the system, its visitors, its accounts or its bill? | **audit-security** |
| Is each published role **true to the employer's posting**, and in scope? | **audit-data** |

The seams that actually come up:

| Case | Owner |
|---|---|
| Is `safeUrl()` / `jsonLdScript()` / `xmlEscape()` correctly **implemented**? | audit-code |
| Is it **used** everywhere it must be? | audit-site |
| What does an attacker gain if it isn't — and what else is exposed (MCP server, CI secrets, DNS, the Cloudflare account)? | audit-security |
| Does the filter bar **overflow** the viewport at 360px? | audit-site |
| Does the filter bar feel **cramped but functional** at 900px? | audit-ui |
| A duplicated helper, an unsound cast, a swallowed error | audit-code |
| A missing `alt`, a 301 in the sitemap, invalid JobPosting JSON-LD | audit-site |
| Wrong visual hierarchy, dead air after a click, a link dump | audit-ui |
| A salary parsed wrong, a fraud-DS role listed as AI, a wrong city | audit-data (the stage's *code* → audit-code) |

**Don't re-litigate a sibling's territory.** When you spot something that
belongs to another skill, write **one line** — `→ audit-code: <one sentence>` —
and move on. Never a section, never a digression. The finding isn't lost; it's
routed.

For a full sweep in one pass, use the **`audit-all`** skill, which establishes a
single shared baseline and dispatches the lenses against it.

## Operating rules

These apply to every audit.

- **Read-only by default.** Produce findings; do not edit files unless the user
  explicitly asks. If asked to fix, do it as a follow-up pass, one logical
  change at a time, re-verifying (typecheck + tests + build) after each.
  **Branch in a worktree, not in place** (`git worktree add ../aiengjobs-wt-<topic>
  -b <branch> origin/main`): the main checkout is shared with other sessions
  and is often dirty with someone's in-flight work, which `git checkout -b`
  either drags along or refuses. Stage by explicit path, never `git add -A`.
  The snapshot is gitignored, so run `npm run snapshot:fetch` in the worktree.
- **Cite evidence.** Every finding gets a `file:line`, a rendered `dist/`
  excerpt, or a screenshot. A finding you can't point at is an opinion.
- **Verify before asserting.** If you claim something is broken, confirm it in
  the source, the built output, or the browser — don't reason it out and report
  it as fact. Mark "needs verification" rather than overstating.
- **Read the comments before flagging.** This codebase documents its deliberate
  choices inline and they are usually right. Before calling something wrong,
  check whether a comment already explains why — then judge whether the
  reasoning still holds. A finding that contradicts a documented decision must
  engage with that decision, not ignore it.
- **Don't invent severity.** Rank by real impact — data corruption, security,
  silent failure, lost indexing, user friction, maintenance cost — not by how
  easy the issue was to spot.
- **Recommend the smallest change that fixes the problem.** "Rewrite this in X"
  is not a finding. If something genuinely needs restructuring, say so once, in
  the architecture/big-picture dimension, with the concrete pain it removes.
- **Distinguish taste from defect.** Preferences are allowed, but they go in the
  lowest tier and are labelled as preferences. Don't inflate them.
- **A clean dimension is a useful result.** Note what's *correct* as well as
  what's wrong. A dimension with nothing to report gets one line ("clean —
  checked X, Y, Z"), not padding.

## The data boundary

`site/src/data/snapshot.json` is **engine-generated** — exported nightly from
the engine's SQLite DB and published on the detached `snapshot` branch.

**Never propose hand-edits to it.** When a defect originates in the data — a bad
salary parse, a wrong country, a mangled title, a missing `postedAt`, a stale
closed flag, a city name that didn't canonicalize — trace it to the stage that
produced it (`engine/src/pipeline/normalize.ts`, `classify.ts`, `encoder.ts`,
`tag.ts`, `comp.ts`, `location.ts`, `region.ts`, `seniority.ts`,
`shared/city.ts`, `engine/src/seed.ts`, `engine/src/export/exportSnapshot.ts`,
or a build-time derivation in `site/src/lib/` such as `postingFacts.ts` and
`payBenchmark.ts`) and recommend fixing it there, plus waiting for or
triggering a refresh. `audit-data` measures these defects role by role.

## Untrusted input

Everything from the 15 ATS connectors (`engine/src/connectors/`) — titles,
company names, descriptions, locations, salaries, apply URLs — is third-party
input. It flows into SQL, into the local classifier, into the published
snapshot, into rendered HTML, JSON-LD and RSS, into the JSON surfaces
(`jobs-data.json`, `mcp-index.json`, `mcp-jobs/*.json`, `llms.txt`), into the
URLs sent to Google's Indexing API and IndexNow, and — through the MCP
server's tool output — into other people's LLM sessions.

That path is the single most important review surface in the repo. Anywhere it
is interpolated — `set:html`, JSON-LD, XML, `href`s, SQL, MCP tool output — is
a first-class review target, not an afterthought. There is no LLM prompt in
the pipeline any more: classification is a local ONNX model.

## Known non-issues — do not report these as findings

Each is deliberate and documented. Verify they're still true, but don't cry
wolf. Reporting one of these is a false positive that costs the whole audit
credibility.

- **`INDEXNOW_KEY` in `engine/src/config.ts` is public by design** — it only
  proves host control, and its twin is served from `site/public/<key>.txt`.
- **`site/src/data/snapshot.json` is gitignored and absent from a fresh clone**
  by design. It's engine-generated and lives on the detached `snapshot` branch
  (~22MB), not in main's history.
- **`.ts` extension imports** (`allowImportingTsExtensions`) are intentional —
  `tsx` for the engine, Astro's bundler for the site, no build step for
  `shared/`.
- **`engine/data/*.db*`** are local dev artefacts and gitignored.
- **`trailingSlash: "ignore"` in `astro.config.mjs` alongside always-trailing-
  slash canonicals** (`Base.astro`, the `canonicalOverride ?? Astro.url.pathname`
  block). GitHub Pages 301s the slash-less form; canonicalizing to a redirect
  would be the bug. The config value and the canonical policy are *supposed* to
  differ.
- **The sitemap's belt-and-braces slash guard** (`sitemap.xml.ts`, the
  `href.endsWith("/")` line) — it looks redundant but handles `url("/")`
  dropping the base's trailing slash, and keeps working if `base` ever returns.
- **`base: "/"` still threaded through `url()`** (`site/src/lib/url.ts`) — the
  site moved to the apex of frontierroles.com, and the indirection was kept on
  purpose so a move back under a path costs nothing. Don't report `url()` as
  dead weight.
- **`MIN_CITY_JOBS = 12`** (`lib/landings.ts:32`) — a deliberate thin-content
  gate, not an arbitrary cutoff. Its *consequences* are fair game; the threshold
  itself is a considered call.
- **`og-default.png` as the fallback** — job and cluster pages get generated
  cards (`site/src/lib/og/`, `pages/og/`); everything else shares the default.
  A known tradeoff, not an oversight.
- **Open roles older than 90 days are unlisted tombstones**
  (`MAX_JOB_AGE_DAYS`, `shared/indexable.ts`) while the nightly run still
  re-verifies them. Thousands of open-but-unlisted rows in the snapshot is the
  design, not a leak.
- **The MCP server is unauthenticated with CORS `*`** — public data, no
  credentials; `audit-security` reasons about its abuse and cost, but the open
  door itself is the product.
- **The local ONNX encoder** in the engine (`pipeline/encoder.ts`) — replacing
  the GPT-5.4-nano call was a deliberate cost and accuracy choice, and shipping
  **fp32 rather than int8** and the 1024-token window are both measured
  tradeoffs recorded in `ml/README.md`. Its *consequences* are fair game; the
  choice is settled. Do not propose int8 quantisation as a size or speed win:
  it was tried and reverted, because `VPMADDUBSW` saturates on x86-64 without
  VNNI and collapsed accuracy from 0.9992 to 0.6583 on a GitHub runner.
- **There is no linter or formatter configured** (no ESLint/Biome/Prettier).
  Only recommend adding one if you can point at real defects it would have
  caught. Don't recommend tooling for its own sake.

## Prerequisites

Most audits need the snapshot. It's gitignored, so on a fresh clone:

```bash
npm run snapshot:fetch               # pulls from the detached `snapshot` branch
```

Without it the site build fails immediately. If the fetch fails (no network, no
branch), **say so in the report** and fall back to what you can do — don't
silently skip pages.

Common entry points:

```bash
npm run typecheck                    # engine + astro check + mcp + root tsc
npm test                             # vitest run
npm run build -w @aiengjobs/site     # full build → site/dist/
npm run dev -w @aiengjobs/site       # → http://localhost:4321/
npm run preview -w @aiengjobs/site   # serves dist/ — closer to production
```

The live site is `https://frontierroles.com/` (GitHub Pages, apex, DNS-only at
Cloudflare); the MCP server is `https://mcp.frontierroles.com/` (a Cloudflare
Worker). The old `alastairrushworth.com/aiengjobs/*` URLs 301 to the apex.

**Check snapshot freshness** whenever you load it: read `generatedAt` and
compare to today. The site advertises "refreshed nightly"; a snapshot more than
~2 days old means the nightly refresh workflow is broken. That's a top-tier finding
in its own right — stale jobs and decaying `validThrough` dates poison Google
for Jobs.

## Browser tooling (claude-in-chrome)

`audit-site`, `audit-ui` and `audit-security` drive the user's real Chrome.
Load every `mcp__claude-in-chrome__*` tool you expect to need in **one**
`ToolSearch`. Gotchas learned on cyclearchive.com against the same extension,
each of which cost time there:

- **`resize_window` reports success and does not change the viewport.** Asked
  for 390px, `innerWidth` stayed 1474 — twice. Always read `innerWidth` back.
  For a real narrow viewport, load the page in a **same-origin `<iframe>` of a
  fixed CSS width** (media queries evaluate against the iframe's width, and the
  frame's DOM can be measured: `scrollWidth > clientWidth` is overflow). Use a
  throwaway tab and a local `npm run preview`, not the live site.
- A first `navigate` can fail with "Navigation to this domain is not allowed"
  **spuriously** — retry in a fresh tab group (`tabs_context_mcp`
  `{createIfEmpty: true}`) before sending the user to the permission settings.
  `localhost` does need an explicit grant the first time; ask up front.
- **Screenshots time out** while an image-heavy page loads. Don't retry in a
  loop: assert through `javascript_tool` DOM reads (computed styles,
  `getBoundingClientRect`) and screenshot only what needs eyes.
- **A `javascript_tool` call dies at ~45 s.** Run long work detached
  (`window.__x = []; (async () => {…})()`) and poll it.
- **Tool output redacts any URL containing `&`** — return a short label with
  it, never the URL alone.
- **`find` is model-backed** and returns a 429 near the usage limit rather than
  a miss — prefer `javascript_tool` selectors.
- **Programmatic `el.focus()` does not match `:focus-visible` in Chrome**, so a
  computed `outline: none` after it proves nothing. Enumerate the stylesheet's
  `:focus-visible` rules instead, and check ancestors for an `overflow: hidden`
  that would clip the ring.
- **`get_page_text` can return stale content after an in-page click** —
  re-`navigate` instead.
- **Leave the browser as you found it**: close your tabs, clear any
  `localStorage` you wrote, and say in the report what you touched.

## Severity

Four tiers, same meaning in every audit. Each skill names them in its own terms
(a code Critical and a UI High-friction sit at the same level).

| Tier | Meaning |
|---|---|
| 🔴 | Breaks something real — data corruption, security, silent production failure, blocked indexing, a journey users bounce from. |
| 🟠 | Genuine impact on correctness, SEO, a11y or engagement. Fix soon. |
| 🟡 | Quality, clarity, consistency, duplication, test gaps. |
| 🟢 | Polish, nits and preferences — labelled as preferences. |

Rank by impact, not by how obvious the issue was.

## Report rules

Every audit produces a prioritized report in the conversation, structured by its
own skeleton. These rules are common to all of them:

- **One finding per issue.** Don't merge unrelated problems into one bullet.
- **A pattern is one finding.** If a problem appears in five places, report it
  **once**, listing all five locations — not five times.
- **Tag each finding** with the dimension it came from, so themes are visible.
  Add the viewport for layout findings and the page type for rendered ones, so
  they're reproducible.
- **Be honest about uncertainty.** Mark "needs verification" for anything you
  couldn't exercise (nightly workflow runs, live feeds, classifier output,
  Google for Jobs guideline calls), and state plainly what you couldn't run and why.
- **Route cross-skill observations** as single `→ audit-<x>` lines.
- **Say what's already good.** A short section calling out the solid patterns
  worth protecting, so a future pass doesn't "fix" them.
- **Finish with the three highest-leverage changes**, in order.
- **End by offering** to (a) fix a chosen subset, or (b) save the report to
  `audits/audit-<skill>-<date>.md`. **Do not write files unasked.**

## Parallel exploration

For broad fan-out reads — "every `catch` block in `engine/src/`", "every `as`
cast", "every `set:html` usage", "every internal link that bypasses `url()`",
"every page's title and description" — you may dispatch `Explore` agents to
gather locations quickly.

Keep the judgement and the severity calls in the main thread: **exploration
finds, you review.** Never report a finding you haven't personally confirmed in
the source, the built output, or the browser.
