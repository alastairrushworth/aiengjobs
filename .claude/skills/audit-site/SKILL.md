---
name: audit-site
description: Run a thorough, deep-thinking review of the aiengjobs Astro site for bugs, correctness issues, SEO concerns (including Google for Jobs / JobPosting structured data), the paginated landing-page system and RSS feeds, accessibility, performance, responsive rendering across mobile and desktop, and big-picture/architecture problems. Use when the user asks to audit, review, or sanity-check the whole site (or a major area of it) rather than a single diff. Covers the rendered site and front-end (site/ — Astro pages, layouts, components, CSS, inline browser JS) as OUTPUT: what a user, a crawler, or a feed reader receives. Source-level code quality, security-guard implementation, the ingestion engine, deploy tooling and CI belong to the audit-code skill. Produces a prioritized findings report; read-only by default (does not edit files unless asked).
---

# Site Audit — aiengjobs

A deep, systematic review of the whole static site: not just "does it build" but
"is it correct, discoverable, accessible, fast, and maintainable." Think hard.
Favour thoroughness over speed — this skill is meant to be run occasionally and
take its time. Surface both **big-picture** concerns (SEO strategy, Google for
Jobs eligibility, duplicate-content risk, information architecture, freshness)
and **small-scale** ones (a missing alt attribute, a filter option that breaks
with zero jobs, an internal link that bypasses the base-path helper).

## Scope boundary

This skill owns the **rendered site** — everything a user, a crawler, or a feed
reader actually receives: Astro pages (`site/src/pages/`), the layout
(`layouts/Base.astro`), components, `site/src/lib/` display helpers,
`site/src/styles/global.css` and per-page `<style>` blocks, inline browser
`<script>`s, SEO, accessibility, structured data, Open Graph, the sitemap,
robots, the RSS feeds, responsive layout, and on-page UX.

**Companion skills.** `audit-code` owns source quality across the whole repo
(including `site/src/` as source); `audit-ui` owns hands-on design critique in a
real browser. The split:

| Question | Skill |
|---|---|
| Is the *output* correct, discoverable, accessible, fast? | **audit-site** (this one) |
| Is the *source* simple, readable, typed, secure, tested? | **audit-code** |
| How does it *look and feel* to use? Where's the friction? | **audit-ui** |
| Is `safeUrl()` / `jsonLdScript()` / `url()` **used** everywhere it must be? | **audit-site** |
| Is `safeUrl()` / `jsonLdScript()` correctly **implemented**? | **audit-code** |

Against `audit-ui` specifically: **this skill asks "does it break?"** (overflow,
tap targets under 44px, contrast below AA, a dead link); audit-ui asks "does it
work *well*?" (hierarchy, density, affordance, journey friction). Design-taste
observations → "→ audit-ui" in one line.

Don't re-litigate a sibling's territory. Duplication across pages, type casts,
dead helpers, test coverage, the engine, `scripts/`, `deploy/` and
`.github/workflows/` → note in one line as "→ audit-code" and move on.

**Exception:** when a site-visible defect originates in the data (see the data
boundary below), trace it to the engine file responsible and say so — that's in
scope as diagnosis, not as an engine review.

## Operating rules

- **Read-only by default.** Produce findings; do not edit files unless the user
  explicitly asks you to fix things. If asked to fix, do it as a follow-up pass,
  one logical change at a time, and re-verify the build.
- **Respect the data boundary.** `site/src/data/snapshot.json` is
  **engine-generated** — exported nightly from the droplet's SQLite DB and
  published on the detached `snapshot` branch. Never propose hand-edits to it.
  If a problem originates in the data (bad salary parse, wrong country, mangled
  title, missing `postedAt`, stale closed flag, a city name that didn't
  canonicalize), trace it to the engine stage responsible
  (`engine/src/pipeline/normalize.ts`, `classify.ts`, `tag.ts`, `comp.ts`,
  `location.ts`, `shared/city.ts`, or `engine/src/export/exportSnapshot.ts`) and
  recommend fixing it there + waiting for (or triggering) a refresh.
- **Treat feed data as untrusted.** Job titles, company names, descriptions,
  locations, and apply URLs come from third-party ATS feeds. Anywhere the site
  interpolates them — especially `set:html`, JSON-LD, RSS/XML, and `href`s — is
  a first-class review surface, not an afterthought (see §9).
- **Read the comments before flagging.** This codebase documents its deliberate
  choices inline and they are usually right. Before calling something wrong,
  check whether a comment already explains why — then judge whether the
  reasoning still holds.
- **Cite evidence.** Every finding gets a `file:line` reference (or a rendered
  `site/dist/` excerpt for build-output issues) so it's actionable and clickable.
- **Don't invent severity.** Rank by real user/SEO/maintenance impact, not by
  how easy it is to spot.
- **Verify before asserting.** If you claim something is broken, confirm it in
  the source or the built output rather than guessing.

### Known non-issues — do not report these as findings

Verify they're still true, but don't cry wolf. Each is deliberate and documented:

- **`trailingSlash: "ignore"` in `astro.config.mjs` alongside always-trailing-
  slash canonicals** (`Base.astro:39-43`). GitHub Pages 301s the slash-less
  form; canonicalizing to a redirect would be the bug. The config value and the
  canonical policy are *supposed* to differ.
- **The sitemap's belt-and-braces slash guard** (`sitemap.xml.ts:11-12`) — it
  looks redundant but handles `url("/")` dropping the base's trailing slash.
- **The gitignored snapshot.** `site/src/data/snapshot.json` is absent from a
  fresh clone by design; it lives on the detached `snapshot` branch (~22MB).
- **`MIN_CITY_JOBS = 12`** (`lib/landings.ts:32`) — a deliberate thin-content
  gate, not an arbitrary cutoff. Its *consequences* are fair game (§2), the
  threshold itself is a considered call.
- **One shared `og-default.png`** across all pages — a known tradeoff, already
  noted below. Flag the cost, don't report it as an oversight.
- **`reasoning_effort: "none"` / GPT-5.4-nano** in the engine — deliberate cost
  choice, and out of scope anyway.

## Step 0 — Build and capture the real output

Before reasoning about source, see what the site actually emits.

```bash
npm run snapshot:fetch               # REQUIRED on a fresh clone — snapshot.json is gitignored
npm run check -w @aiengjobs/site     # astro check — type + template diagnostics
npm run build -w @aiengjobs/site     # full build → site/dist/
npm test                             # vitest — display-format helpers have tests
```

- **Fetch the snapshot first.** Without it the build fails immediately and the
  audit stalls. If the fetch fails (no network, no `snapshot` branch), say so in
  the report and fall back to source-only review — don't silently skip pages.
- Treat build **warnings and errors** as first-class findings.
- **Check freshness.** Read `generatedAt` in the snapshot and compare to today.
  The site advertises "refreshed nightly" — a snapshot more than ~2 days old
  means the droplet refresh loop is broken, which is a Critical finding in its
  own right (stale jobs + decaying `validThrough` dates poison Google for Jobs).
- Record the numbers you'll reason about later: build time, page count in
  `dist/`, `dist/index.html` size, `dist/jobs-data.json` size, `dist/sitemap.xml`
  size and URL count.

## Step 0.5 — Enumerate the current site before auditing it

**Do this every run. Do not audit from the page list in this document** — the
site grows new page types, and a hardcoded inventory is how an audit ends up
reviewing a site that no longer exists.

1. List the routes: `site/src/pages/**` — note every `.astro` page, every
   `.ts` endpoint (sitemap, robots, RSS, `jobs-data.json`), and which are
   parameterized.
2. Derive the landing set from `site/src/lib/landings.ts`: `LANDINGS` =
   stack clusters (`CLUSTER_PAGES`) + `remote-ai-jobs` + one page per city
   clearing `MIN_CITY_JOBS`. **The city set is data-driven and changes every
   refresh** — count what's actually in `dist/` rather than assuming.
3. Note `PAGE_SIZE` and compute the paginated slice count (`pageCount`), because
   it multiplies every listing-page check below.
4. Build the audit sample: one of **each** page type, plus the extremes.
   As of writing that means the homepage, a cluster landing (page 1 **and** a
   page ≥2), a city landing, `remote-ai-jobs`, a landing with exactly one page,
   an open job, a **closed-job tombstone** (find one via `isClosed`), a
   **duplicate job** that sets `dupCanonicalSlug` (`jobs/[slug].astro`, via
  `duplicateOf()`), a
   company page, `salaries/`, a salary cluster page, `stats/`, `404.html`,
   `sitemap.xml`, `robots.txt`, `rss.xml`, a per-landing `<slug>/rss.xml`, and
   `jobs-data.json`. **Re-derive this list from what you found in steps 1–2** —
   if a page type exists that isn't named here, audit it and say so in the
   report.

Source templates hide bugs that only appear once rendered (empty tags, doubled
meta, malformed JSON-LD, entity-mangled titles), so inspect the *built* HTML for
every type in your sample.

### Link checking — with a budget

Astro has **no built-in link checker**. Verify internal links yourself by
extracting `href`s from `site/dist/**/*.html` and checking each resolves to a
file in `dist/`. Two things make this non-trivial at current size (dozens of
landings × paginated slices × every job page), so:

- **Script it** into the scratchpad rather than spot-checking by hand.
- Account for the `/aiengjobs` base prefix **and** for `trailingSlash: "ignore"`
  — naive matching produces false positives on the slash-less form. Normalize
  before comparing.
- **Report your coverage** ("checked 8,412 links across 1,203 pages, 3 broken")
  so a clean result is meaningful. If you sampled rather than swept, say which
  pages and why.

### Rendering at real viewports

§8 (responsive) cannot be done from source. Do this concretely:

```bash
npm run dev -w @aiengjobs/site       # → http://localhost:4321/aiengjobs/
```

Then drive it with the **`claude-in-chrome`** tools — `tabs_create_mcp` +
`navigate` to reach a page, `resize_window` to set each width, `computer` to
screenshot. (`npm run preview` against `dist/` works equally well and is closer
to production.) If no browser tooling is available in the session, **say so
explicitly in the report** and mark §8 as source-only — do not quietly skip it,
because layout overflow and overlap are invisible in source.

## Review dimensions

Work through every dimension below. For each, note what's correct as well as
what's wrong — a clean dimension is a useful result too. **A dimension with
nothing to report gets one line** ("clean — checked X, Y, Z"), not padding.

### 1. Build & correctness

- `astro check` / build errors and warnings; vitest failures.
- The snapshot shape guard in `site/src/lib/data.ts` — does it still match what
  the exporter emits? Silent schema drift between `shared/types.ts`,
  `exportSnapshot.ts`, and the site's assumptions is the classic failure here.
- **Base-path integrity.** The site is served under `base: "/aiengjobs"`.
  Every internal link, asset reference, and redirect must go through the
  `url()` helper (`site/src/lib/url.ts`). Grep pages/components/CSS/inline JS
  for hardcoded root-relative paths (`href="/…"`, `fetch("/…")`, `url(/…)`)
  that would 404 in production but work if dev happened to mask them.
- Rendering logic bugs in page front-matter: sorting/filter-count computations
  in `index.astro`; `getStaticPaths` in `[topic]/[...page].astro`,
  `jobs/[slug].astro`, `companies/[slug].astro`, `salaries/[cluster].astro`,
  `[topic]/rss.xml.ts` (slug collisions between a city and a cluster, jobs in
  zero clusters, companies with no open jobs); related-jobs selection; salary
  aggregation.
- Edge inputs: zero open jobs, a job missing `postedAt`/salary/location/
  country, empty filter results, a country code `countryName()` doesn't know,
  fx rates missing a currency, a city whose name collides across countries
  (`landings.ts` names the countries in copy — verify it renders sanely). What
  appears — something sane, or `undefined`?
- **The client-side filter/sort script** in `index.astro`: the payload now
  arrives from `/jobs-data.json` (`index.astro`, via the `data-src` attribute
  and the `dataPromise ??=` fetch), so check the *fetch
  failure path* — a 404, an offline user, a slow response. Does the UI degrade
  to the 50 server-rendered cards with a visible state, or hang/blank? Does the
  compact payload (`lib/jobsPayload.ts`) stay in sync with what `JobCard`
  renders server-side, so filtered results don't look different from initial ones?
- Tombstone behaviour: closed jobs render a noindexed page (not a 404), aren't
  listed anywhere, and their "related jobs" links point only at open roles.
- **Duplicate-job canonicalization**: `jobs/[slug].astro` points the canonical
  at `dupCanonicalSlug` (from `duplicateOf()`) when a role appears more than
  once, and suppresses that page's JobPosting JSON-LD. Verify the
  target exists, is open, isn't itself a duplicate (no canonical chains/loops),
  and that the duplicate is handled consistently in the sitemap and JobPosting.
- 404 page works and is styled — and note that GitHub Pages serves
  `404.html` at the domain root, so its asset/nav links must survive that.
- Entity/encoding correctness: ATS feeds deliver HTML entities and stray markup
  in titles/locations — `decodeEntities` used consistently, nothing
  double-escaped or raw-escaped in visible text.

### 2. Landing pages, pagination & feeds

The largest surface on the site and the core of the programmatic-SEO strategy:
one route (`pages/[topic]/[...page].astro`) and one template
(`components/LandingPage.astro`) serve stack clusters, city pages and remote,
each paginated at `PAGE_SIZE`, each with its own RSS feed.

**Pagination correctness**
- **Canonicals on page ≥2.** Each slice should **self-canonicalize** — pointing
  every slice at page 1 is the common mistake and hides those roles. Confirm
  what `Base.astro` actually emits for `/<slug>/2/` (it has no
  `canonicalOverride`, so verify that resolves to the slice's own URL).
- `rel="prev"`/`rel="next"` (`Base.astro:56-57`) — present, absolute,
  base-prefixed, correct at the first and last slice (no `prev` on page 1, no
  `next` on the last).
- **Differentiated metadata per slice.** `LandingPage.astro:32,75-76` appends
  "page N of M" to the title and description. Verify no two slices share a
  title/description, and that the `<h1>` doesn't repeat identically across
  slices in a way that reads as duplicate content.
- `/<slug>/1` must not exist as a duplicate of `/<slug>` — check `dist/` and
  the sitemap agree on one form.
- The last slice when the count divides exactly; a landing with exactly one page
  (no pager, no prev/next); the empty-state branch (`LandingPage.astro:100`) —
  can it ever render in a built page, and what does it say?
- **Sitemap ↔ built pages parity.** `sitemap.xml.ts:23-28` emits `/<slug>` plus
  `/<slug>/2…N` from `pageCount()`. Diff the sitemap's URL set against what's
  actually in `dist/` — any mismatch is a crawl-budget or missing-page bug.
- `ItemList` JSON-LD positions (`LandingPage.astro:47-50`) must continue across
  slices (`page.start + i + 1`), not restart at 1 on every page.
- Stats block renders only on page 1 (`LandingPage.astro:39`) — intended; verify
  page ≥2 doesn't look broken or empty as a result.

**Landing-page lifecycle — index hygiene**
- City pages exist only while a city clears `MIN_CITY_JOBS`. A city that drops
  below it **silently stops being generated**: the URL leaves the sitemap and
  starts 404ing with no redirect or 410, after Google has indexed it. Assess the
  real exposure (how many landings sit just above the threshold today?) and
  whether hysteresis, a redirect to the homepage, or a retained stub would cost
  less than the churn. This is the highest-value *strategic* question on the
  site right now.
- The inverse: a new city page appearing with thin, near-duplicate copy.
- **Slug collisions** between the city namespace (`ai-jobs-<city>`) and cluster
  slugs, and stability of `citySlug()` output across refreshes — a slug that
  changes shape breaks every inbound link to it.
- Are city/cluster landings **differentiated** from each other and from the
  homepage — distinct h1, intro, counts, stats block — or thin permutations of
  one job list?
- **Coverage asymmetry:** `salaries/[cluster].astro` covers clusters only, not
  cities or remote. Is that deliberate (salary data too thin per city) or a gap?
  Say which, and check the nav doesn't imply pages that don't exist.

**RSS feeds**
- `rss.xml` (site-wide) and `<slug>/rss.xml` (per landing, `[topic]/rss.xml.ts`)
  — verify each builds, is valid RSS 2.0, and is reachable.
- **XML escaping of untrusted feed data.** `xmlEscape` (`lib/feed.ts:12-19`)
  must cover every interpolated field — title, company, location, summary, and
  **URLs**. A stray `&` or `<` from an ATS title is the classic feed-breaking
  bug; check a built feed parses.
- RFC-822 dates (`feed.ts:22-26`), not ISO 8601 — and what happens when
  `postedAt` is missing or unparseable.
- `MAX_ITEMS = 100` — sensible cap; confirm items are newest-first so the cap
  keeps the *right* 100.
- Absolute, base-prefixed URLs in `<link>`/`<guid>`; stable `guid`s across
  refreshes (a guid that changes re-notifies every subscriber).
- Discoverability: `<link rel="alternate">` in `Base.astro:59-62` points at the
  *right* feed per page (`LandingPage.astro:74,80` passes a per-landing one).
- Closed jobs must not appear in any feed.

### 3. SEO

This is a programmatic-SEO job board; organic search is the distribution
strategy (spec §8). Review it end-to-end. (Pagination and landing-page SEO are
covered in §2 — don't duplicate them here.)

- **JobPosting structured data (Google for Jobs) — the crown jewel.** Every
  open job page emits a `JobPosting` JSON-LD block; validate it against
  Google's required + recommended fields: `title` (role only, no company/
  location stuffing), `datePosted`, `validThrough` (present? in the future?
  what happens as the snapshot ages?), `hiringOrganization`, `jobLocation` vs
  `jobLocationType: TELECOMMUTE` + `applicantLocationRequirements` for remote
  roles, `baseSalary` with correct currency/unit/range, `directApply`,
  `employmentType`. Check the tombstone pages do NOT emit JobPosting (a closed
  job with structured data is a guidelines violation), and that a
  `dupCanonicalSlug` duplicate doesn't emit a competing JobPosting for the same
  role. Spot-check emitted JSON from `dist/` parses and is well-typed.
- **Other JSON-LD:** `ItemList`/`CollectionPage`/`Organization`/`BreadcrumbList`
  blocks on the homepage, landings, company and salary pages — valid,
  non-duplicative, consistent `@id`s, and every block routed through
  `jsonLdScript()`.
- **Titles & descriptions:** unique, present, sensibly-lengthed on **every page
  type in your Step 0.5 sample**. Watch for pages inheriting the generic default
  description in `Base.astro`, and for near-duplicate titles between a cluster
  landing and its `/salaries/<cluster>` twin.
- **Canonicals & the trailing-slash story:** `Base.astro` canonicalizes to the
  trailing-slash form (what GitHub Pages actually serves; slash-less 301s).
  Verify sitemap URLs, internal links, feed links, and canonicals all agree — a
  sitemap or nav full of 301s wastes crawl budget. Also: github.io 301s to
  alastairrushworth.com; `site` config, canonicals, and OG URLs must all use
  the final domain.
- **Sitemap** (`site/src/pages/sitemap.xml.ts`): every indexable URL present
  (home, stats, salaries, every landing + its slices, salary clusters, companies
  with open jobs, open jobs); nothing noindexed or closed listed; tombstones
  correctly absent; `lastmod` values sane (job `updatedAt ?? postedAt`
  fallback); companies whose last job just closed drop out cleanly. Note the
  total URL count and whether it's approaching the 50k/50MB limit that would
  require a sitemap index.
- **robots.txt** (`site/src/pages/robots.txt.ts`): coherent with the sitemap;
  sitemap URL absolute and base-prefixed. Should `jobs-data.json` be crawlable?
- **Indexability:** `noindex` only on tombstones and 404 — nothing real
  accidentally noindexed, and nothing that *should* be noindexed left open.
- **Open Graph / Twitter cards:** per-page title/description/url; everything
  shares one `og-default.png` — flag whether per-job/per-landing OG would be
  worth it, and check the default image exists, is sized right (1200×630),
  and isn't bloated.
- **Freshness signals:** "Updated {date}", `lastmod` in the sitemap, feed
  `pubDate`s, `datePosted`/`validThrough` in JobPosting — all derive from
  `generatedAt`; verify they agree and behave when the snapshot is stale.
- **Headings:** exactly one `<h1>` per page, logical nesting, no skips.
- **Internal linking & crawlability:** pagination now gives every role a
  crawlable in-site link — **verify that holds** (a role on page 7 of a busy
  landing is reachable by a crawler that runs no JS). Check `BrowseNav`
  cross-links, footer/nav quality, orphan pages, and `rel` on outbound apply
  links.

### 4. Accessibility (a11y)

- Landmark structure (`header`/`nav`/`main`/`footer`), the skip link in
  `Base.astro`, focus order.
- The homepage filter controls: `<label for=…>` pairings, keyboard
  operability, focus-visible styles, and — critically — whether client-side
  filtering announces result-count changes (aria-live) or silently reshuffles.
  Now that results arrive via `fetch`, is the loading state announced too?
- **Pagination a11y:** the pager (`LandingPage.astro:106-113`) needs an
  accessible name, current-page indication (`aria-current`), and link text that
  isn't bare "← Newer / Older →" out of context.
- `BrowseNav` uses `aria-label="Related pages"` by default — verify each
  instance passes something distinguishing when there are several on a page.
- Colour contrast in `global.css` (including the "new" badge, muted meta text,
  and link colours), target sizes on touch.
- `lang` attribute, `prefers-reduced-motion` handling (global.css gates
  animation on `no-preference` — verify nothing animates outside it).
- Stats-page charts and the landing stats block: readable by screen readers
  (tables/text fallback) or purely visual?
- Alt text on the few images; decorative icons hidden from AT.

### 5. Performance

- **The homepage payload is no longer inline.** `index.astro` server-renders the
  newest 50 cards and lazily fetches `/jobs-data.json` on first interaction
  (`lib/jobsPayload.ts`, `pages/jobs-data.json.ts`). So the questions are now:
  how big is `dist/jobs-data.json` today, how does it grow, is it fetched once
  and cached (`dataPromise ??=`), and what's the interaction latency on a slow
  connection? Measure both `dist/index.html` and `dist/jobs-data.json`.
- **Landing pages** were the fix for a 652KB / 15k-node document
  (`landings.ts:110`). Verify the fix holds: measure a busy landing's page-1
  HTML size and DOM node count, and confirm no page type has quietly regressed
  to rendering an unbounded list.
- **Build time and page count.** Pagination multiplies page count; RSS adds one
  endpoint per landing. Note current build time and what drives it, and reason
  about 5× jobs — including anything O(n²) in page front-matter (related-jobs
  selection runs per job page × N pages).
- Render-blocking: GA gtag is `async` and last in head — verify that holds;
  no other third-party scripts creep in.
- CSS strategy: one small global.css + per-page scoped styles — fine today;
  flag real bloat only if found.
- Font loading (system stack vs webfonts), image weights (`public/` PNGs —
  og-default, touch icons), `loading="lazy"` where sensible.
- The stats page's inline data — same growth question as the old homepage payload.

### 6. Front-end code quality (light pass — defer to audit-code)

`audit-code` owns source quality, including `site/src/`. Here, only flag code
issues that a **rendered-output** finding traces back to — e.g. a filter script
that silently swallows a fetch error (a UX bug), or a page reimplementing a
`lib/format.ts` helper inconsistently (a *visible* inconsistency between two
pages).

Everything else — duplication, dead code, type casts, naming, `lib/`
organisation, whether inline `<script>`s should be modules — write as a single
line: "→ audit-code: <one-sentence pointer>". Do not enumerate.

### 7. Content & UX

- Hero, intro, and footer copy: accurate claims ("salary-transparent, no ghost
  jobs", "refreshed nightly", live counts), typos, tone.
- **Landing copy** (`lib/clusters.ts` for stacks, `lib/landings.ts:96-98` for
  cities): the city intro is templated — read several rendered ones and judge
  whether they read as written-for-humans or as mail-merge. Check the
  multi-country phrasing ("Covers Cambridge in United States, United Kingdom")
  actually reads well, and that counts in copy match counts on the page.
- Empty/edge states a user actually sees: zero filter results, a job with no
  salary ("salary-transparent" board — how are no-salary roles presented?),
  tombstone messaging for a closed role, a landing's last page with few roles,
  404 helpfulness.
- The apply flow: apply link prominent, opens the ATS posting, clearly
  first-party; `safeUrl` guard behaviour when an apply URL is bad.
- Date honesty: "posted 3 days ago" vs `generatedAt` drift; "new" badge logic.
- Navigation coherence: header vs footer vs `BrowseNav` cross-links vs the
  in-page browse rows — consistent, complete, and not linking to landings that
  no longer exist.

### 8. Responsive rendering (mobile & desktop)

The site must render well across viewports — small phones, tablets, laptops,
wide desktops. Job seekers browse heavily on phones, so mobile breakage tends
to be High/Critical. **Render it — see Step 0.5.** Source review alone cannot
find overflow or overlap. This section hunts **breakage**; whether the
responsive layout *feels* good is `audit-ui`'s.

- Confirm the viewport meta in `Base.astro`.
- Read **every** `@media` query and the layout primitives that drive reflow:
  `global.css` (breakpoints at 560px and 480px), plus the scoped `<style>`
  blocks in `index.astro`, `LandingPage.astro`, `LandingStats.astro`,
  `jobs/[slug].astro`, and `stats.astro` (which adds its own 720px/440px
  breakpoints). For each breakpoint ask: what changes, and is there a width
  *between* breakpoints where the layout goes awkward? Flag breakpoint
  inconsistency across files as a maintainability finding.
- Render each page type from your Step 0.5 sample at ~360px, ~390–414px,
  ~768px, ~1024px, ~1280px, ~1600px+ — portrait and landscape for phone sizes.

**Failure modes to hunt for, on every page type:**
- **Horizontal overflow at ~360px:** long unbroken strings are endemic to job
  data — long titles, company names, location strings, salary ranges, skill
  tags; wide stat tables/charts need overflow wrappers; nothing forces sideways
  scroll.
- **Filter bar reflow:** the search input + role/country/seniority selects +
  sort control wrap gracefully at intermediate widths and stay usable.
- **Job cards & fact grids:** cards keep sane proportions across widths; the
  job-page facts block reflows rather than truncates.
- **The landing stats block** (`LandingStats.astro`): tiles, medians and
  top-companies/top-skills lists reflow rather than overflow at 360px.
- **The pager:** prev/next/position row stays on one line or wraps cleanly, and
  its targets are thumb-sized.
- **Touch targets:** filter controls, job-card links, skill tags, pager, apply
  button ≈44×44px with adequate spacing.
- **Wide screens:** content capped and centred (`.container`), readable line
  length on job descriptions, no edge-to-edge sprawl at 1600px+.
- **Stats charts:** legible and non-overflowing on a phone; labels don't
  collide at 440px.
- **Typography & zoom:** base size legible on mobile; **inputs ≥16px** (the
  search input — iOS auto-zooms below that); layout survives 200% zoom without
  horizontal scroll.
- **Hover-only affordances:** anything shown on `:hover` has a touch equivalent.

Tag every responsive finding with the viewport(s) it affects (e.g. `≤480px`,
`768–1024px`, `≥1600px`) so it's reproducible.

### 9. Security hygiene (rendered output)

`audit-code` owns whether the guards are correctly *implemented*. This section
owns whether they're **used everywhere they must be** — the attack surface is
untrusted ATS feed data reaching a rendered page.

- Every `set:html` in `site/src/` — JSON-LD must go through `jsonLdScript()`;
  any HTML-bodied content (job descriptions) must be sanitized at the source or
  escaped at render. Check the *rendered* `dist/` output, not just the template.
- **XML/RSS escaping**: every interpolated field in `lib/feed.ts` output goes
  through `xmlEscape`. Fetch a built feed and confirm it parses.
- `href` injection: verify every feed-derived URL (apply links, company sites)
  goes through `safeUrl()`.
- Outbound links: `rel="noopener noreferrer"` (plus `nofollow`/`sponsored`
  judgement on apply links), `target` usage.
- No secrets in client code, config, or anything published — including
  `jobs-data.json` and the feeds. Check what `jobsPayload.ts` exposes is all
  intended to be public.
- The GA snippet: inline `is:inline` script is static — verify nothing dynamic
  ever gets interpolated into it.
- Third-party surface: currently just GA — flag any additions.

### 10. Big-picture / architecture

- Is the SEO strategy coherent end-to-end (sitemap ↔ robots ↔ canonicals ↔
  JSON-LD ↔ feeds ↔ internal links all telling crawlers the same story —
  including the base path, trailing slashes, and pagination)?
- **Index-bloat governance.** The site generates a page per city above a
  threshold, each paginated. What stops that growing into thousands of thin
  URLs, and is `MIN_CITY_JOBS` still the right lever at 5× the job count?
- Single source of truth: site URL/base (astro.config ↔ url.ts ↔ sitemap ↔
  robots ↔ engine's `config.ts`), brand strings, the cluster taxonomy
  (`shared/taxonomy.ts` ↔ `lib/clusters.ts`), `PAGE_SIZE` (shared between the
  route and the sitemap — verify nothing else hardcodes 50).
- The snapshot contract: is `SiteSnapshot` the *only* interface between engine
  and site, and does anything on the site silently depend on engine
  implementation details (e.g. city-name canonicalization it doesn't control)?
- Scalability: what breaks first as jobs grow 5×–10× — `jobs-data.json` size,
  build time (N job pages × related-jobs scan), sitemap URL count, the number
  of city landings, filter UX?
- Resilience: what does the site do when the nightly refresh stops — how stale
  can it get before it's actively harmful (wrong "posted X days ago", expired
  `validThrough`, ghost jobs on a "no ghost jobs" board)? Is there any staleness
  guard at build time?
- The custom-domain migration noted in `astro.config.mjs` (dropping `base` for
  a dedicated domain): would today's code survive it, or are there hidden
  hardcoded-base assumptions that will bite?

## Output — the report

Present findings in the conversation as a prioritized report:

```
# Site Audit — aiengjobs (<date>)

## Summary
<3–6 sentences: overall health, the biggest themes, and the single most important fix.>

## Baseline
snapshot generatedAt: <date, N days old>  ·  build: <pass/fail, time>
pages in dist: <n>  ·  landings: <n clusters + n cities + remote>  ·  sitemap URLs: <n>
index.html: <size>  ·  jobs-data.json: <size>
links checked: <n across n pages>  ·  viewports rendered: <list, or "none — no browser tooling">

## Health by area
| Area | Verdict | Notes |
|------|---------|-------|
| Build & correctness   | ✅ / ⚠️ / ❌ | one line |
| Landings & pagination |  |  |
| Feeds (RSS)           |  |  |
| SEO / structured data |  |  |
| Accessibility         |  |  |
| Performance           |  |  |
| Content & UX          |  |  |
| Responsive            |  |  |
| Security hygiene      |  |  |

## 🔴 Critical   (breaks the build, blocks indexing/Google for Jobs, or breaks for users)
## 🟠 High        (real SEO/a11y/correctness impact; should fix soon)
## 🟡 Medium      (quality, clarity, maintainability, minor SEO)
## 🟢 Low / Nits  (polish, style, optional improvements)

For each finding:
- **<short title>** — `path:line`
  - What & why it matters (user/SEO/maintenance impact)
  - Recommended fix (and whether it's engine-level vs. site-level)

## What's already good
<brief — call out solid patterns worth preserving so they aren't "fixed" later.>

## If you only do three things
<the three highest-leverage fixes, in order.>
```

Rules for the report:
- One finding per issue; don't merge unrelated problems.
- If a problem shows up on five page types, report it **once** as a pattern with
  all five locations — not five times.
- For layout/responsive findings, name the affected viewport(s) (e.g. `≤480px`)
  and whether it's mobile, desktop, or both, so they're reproducible.
- If a problem is data/engine-generated, say so and point at `engine/src/…`,
  not at `snapshot.json`.
- Source-quality observations get one "→ audit-code" line each, not a section.
- Be honest about uncertainty — mark "needs verification" rather than
  overstating (especially for Google for Jobs guideline calls you can't test
  live), and state plainly anything you couldn't run (no snapshot, no browser).
- End by offering to (a) fix a chosen subset, or (b) save the report to a file
  (e.g. `audits/audit-site-<date>.md`). Do not write files unasked.

## Optional: parallel exploration

For broad fan-out reads (e.g. "every `set:html` usage", "every internal link
that bypasses `url()`", "every page's title/description", "every landing's
rendered h1") you may dispatch `Explore` agents to gather locations quickly,
then do the actual judgement yourself. Keep the analysis and severity calls in
the main thread — exploration finds, you review. Never report a finding you
haven't personally confirmed in the source or the built output.
