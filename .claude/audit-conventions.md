# Audit conventions — aiengjobs

Shared ground rules for the `audit-code`, `audit-site` and `audit-ui` skills.
Every audit skill reads this file first, then applies its own scope, review
dimensions and report skeleton on top.

Edit this file to change how **all** the audits behave. Anything that is true of
only one audit belongs in that skill's `SKILL.md`, not here.

---

## The three-way split

One repo, one site, three lenses. Each skill owns one column and stays out of
the others'.

| Question | Skill |
|---|---|
| Is the **source** correct, simple, readable, typed, secure, tested? | **audit-code** |
| Is the **output** correct, discoverable, accessible, fast, unbroken? | **audit-site** |
| Does it **look and feel** considered? Where's the friction? | **audit-ui** |

The seams that actually come up:

| Case | Owner |
|---|---|
| Is `safeUrl()` / `jsonLdScript()` / `xmlEscape()` correctly **implemented**? | audit-code |
| Is it **used** everywhere it must be? | audit-site |
| Does the filter bar **overflow** the viewport at 360px? | audit-site |
| Does the filter bar feel **cramped but functional** at 900px? | audit-ui |
| A duplicated helper, an unsound cast, a swallowed error | audit-code |
| A missing `alt`, a 301 in the sitemap, invalid JobPosting JSON-LD | audit-site |
| Wrong visual hierarchy, dead air after a click, a link dump | audit-ui |

**Don't re-litigate a sibling's territory.** When you spot something that
belongs to another skill, write **one line** — `→ audit-code: <one sentence>` —
and move on. Never a section, never a digression. The finding isn't lost; it's
routed.

For a full sweep across all three layers in one pass, use the **`audit-all`**
skill, which establishes a single shared baseline and dispatches all three.

## Operating rules

These apply to every audit.

- **Read-only by default.** Produce findings; do not edit files unless the user
  explicitly asks. If asked to fix, do it as a follow-up pass, one logical
  change at a time, re-verifying (typecheck + tests + build) after each.
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
the droplet's SQLite DB and published on the detached `snapshot` branch.

**Never propose hand-edits to it.** When a defect originates in the data — a bad
salary parse, a wrong country, a mangled title, a missing `postedAt`, a stale
closed flag, a city name that didn't canonicalize — trace it to the pipeline
stage that produced it (`engine/src/pipeline/normalize.ts`, `classify.ts`,
`tag.ts`, `comp.ts`, `location.ts`, `shared/city.ts`, or
`engine/src/export/exportSnapshot.ts`) and recommend fixing it there, plus
waiting for or triggering a refresh.

## Untrusted input

Everything from the 12 ATS connectors — titles, company names, descriptions,
locations, salaries, apply URLs — is third-party input. It flows into SQL, into
LLM prompts, into the published snapshot, and into rendered HTML, JSON-LD and
RSS.

That path is the single most important review surface in the repo. Anywhere it
is interpolated — `set:html`, JSON-LD, XML, `href`s, SQL, prompts — is a
first-class review target, not an afterthought.

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
  slash canonicals** (`Base.astro:39-43`). GitHub Pages 301s the slash-less
  form; canonicalizing to a redirect would be the bug. The config value and the
  canonical policy are *supposed* to differ.
- **The sitemap's belt-and-braces slash guard** (`sitemap.xml.ts:11-12`) — it
  looks redundant but handles `url("/")` dropping the base's trailing slash.
- **`MIN_CITY_JOBS = 12`** (`lib/landings.ts:32`) — a deliberate thin-content
  gate, not an arbitrary cutoff. Its *consequences* are fair game; the threshold
  itself is a considered call.
- **One shared `og-default.png`** across all pages — a known tradeoff. Flag the
  cost if relevant; don't report it as an oversight.
- **`reasoning_effort: "none"` / GPT-5.4-nano** in the engine — a deliberate
  cost choice.
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
npm run typecheck                    # engine tsc --noEmit + astro check
npm test                             # vitest run
npm run build -w @aiengjobs/site     # full build → site/dist/
npm run dev -w @aiengjobs/site       # → http://localhost:4321/aiengjobs/
npm run preview -w @aiengjobs/site   # serves dist/ — closer to production
```

**Check snapshot freshness** whenever you load it: read `generatedAt` and
compare to today. The site advertises "refreshed nightly"; a snapshot more than
~2 days old means the droplet refresh loop is broken. That's a top-tier finding
in its own right — stale jobs and decaying `validThrough` dates poison Google
for Jobs.

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
  couldn't exercise (droplet ops, live feeds, LLM responses, Google for Jobs
  guideline calls), and state plainly what you couldn't run and why.
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
