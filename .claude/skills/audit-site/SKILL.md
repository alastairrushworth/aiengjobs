---
name: audit-site
description: Run a thorough, deep-thinking review of the frontierroles.com Astro site (the aiengjobs repo) for bugs, correctness issues, SEO concerns (including Google for Jobs / JobPosting structured data), the paginated landing-page system, RSS and JSON feeds, accessibility, performance, responsive rendering across mobile and desktop, and big-picture/architecture problems. Use when the user asks to audit, review, or sanity-check the whole site (or a major area of it) rather than a single diff — AND when they ask to check Google Search Console, GA4, indexing or coverage, crawl stats, 404s, "why isn't this page indexed" or search traffic for the site (§11 holds the baselines and the working-as-designed list). Covers the rendered site and front-end (site/ — Astro pages, layouts, components, CSS, inline browser JS) as OUTPUT: what a user, a crawler, or a feed reader receives. Source-level code quality, security-guard implementation, the ingestion engine, deploy tooling and CI belong to the audit-code skill; the adversarial security pass (headers, the MCP server, secrets, DNS) belongs to audit-security. For a full sweep across source, rendered output and UI together, use audit-all instead. Produces a prioritized findings report; read-only by default (does not edit files unless asked).
---

# Site Audit — aiengjobs

**Read `.claude/audit-conventions.md` first.** It carries the rules shared by
all the audit skills — the scope split, operating rules, the data boundary,
known non-issues, severity tiers and report rules. This file adds only what's
specific to auditing the rendered site.

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
real browser. See the split table in the shared conventions.

Against `audit-ui` specifically: **this skill asks "does it break?"** (overflow,
tap targets under 44px, contrast below AA, a dead link); audit-ui asks "does it
work *well*?" (hierarchy, density, affordance, journey friction). Design-taste
observations → "→ audit-ui" in one line.

**Exception to the no-trespassing rule:** when a site-visible defect originates
in the data, trace it to the engine file responsible and say so — that's in
scope as diagnosis, not as an engine review. (See the data boundary in the
shared conventions for where to point.)

## Operating rules

The shared rules in `.claude/audit-conventions.md` apply in full — read-only by
default, cite evidence, verify before asserting, read the comments before
flagging, the known non-issues list, real-impact severity. Specific to a site
audit:

- **Evidence can be rendered output.** A `site/dist/` excerpt is as good as a
  `file:line`, and for build-output issues it's better. Inspect what the build
  actually emitted, not just the template that produced it.
- **The untrusted-input surface is §9.** Anywhere the site interpolates feed
  data — `set:html`, JSON-LD, RSS/XML, `href`s — is first-class, not an
  afterthought.

## Step 0 — Build and capture the real output

Before reasoning about source, see what the site actually emits.

```bash
npm run snapshot:fetch               # REQUIRED on a fresh clone — snapshot.json is gitignored
npm run check -w @aiengjobs/site     # astro check — type + template diagnostics
npm run build -w @aiengjobs/site     # full build → site/dist/
npm test                             # vitest — display-format helpers have tests
```

- **Fetch the snapshot first** and check its freshness — see Prerequisites in
  the shared conventions. Without it the build fails immediately and the audit
  stalls.
- Treat build **warnings and errors** as first-class findings.
- Record the numbers you'll reason about later: build time, page count in
  `dist/`, `dist/index.html` size, `dist/jobs-data.json` size, `dist/sitemap.xml`
  size and URL count.

## Step 0.5 — Enumerate the current site before auditing it

**Do this every run. Do not audit from the page list in this document** — the
site grows new page types, and a hardcoded inventory is how an audit ends up
reviewing a site that no longer exists.

1. List the routes: `site/src/pages/**` — note every `.astro` page, every
   `.ts` endpoint (sitemap, robots, the RSS feeds, the `jobs-data.json`
   payloads, `llms.txt`, the MCP JSON, the OG PNGs), and which are
   parameterized.
2. Derive the landing set from `site/src/lib/landings.ts`: `LANDINGS` =
   stack clusters (`CLUSTER_PAGES`) + `remote-ai-jobs` + the city pages from
   `buildCityLandings`. A city publishes at `MIN_CITY_JOBS` and, once up, is
   retained down to `RETAIN_CITY_JOBS` while recent closures show it was over
   the line; a city name with two evidenced homes (`lib/cityPlaces.ts`,
   `MIN_PLACE_EMPLOYERS`) splits into one page per country — the owner keeps
   `ai-jobs-<city>`, the twin gets `ai-jobs-<city>-<country>`. **The city set
   is data-driven and changes every refresh** — count what's actually in
   `dist/` rather than assuming.
3. Note `PAGE_SIZE` and count the slices actually built (`<slug>/<n>/` and
   `companies/<slug>/<n>/` in `dist/`) — they multiply every listing-page check
   below. Slices ≥2 are built and linked but noindexed and kept out of the
   sitemap.
4. Build the audit sample: one of **each** page type, plus the extremes.
   As of writing that means the homepage, a cluster landing (page 1 **and** a
   page ≥2), a city landing, a **split-city** landing pair if one exists,
   `remote-ai-jobs`, a landing with exactly one page, an open job, one of
   **each tombstone kind** (`retired` in `jobs/[slug].astro`: closed,
   aged-out, delisted), a **duplicate job** that sets `dupCanonicalSlug` (via
   `duplicateOf()` in `lib/data.ts`), a company page with one slice and a
   **paginated** one (page 1 **and** ≥2), a one-role company page (noindexed
   under `MIN_INDEXED_COMPANY_ROLES`), `stats/`, `mcp/`, `404.html`,
   `sitemap.xml`, `robots.txt`, `llms.txt`, `rss.xml`, `daily/rss.xml`, a
   per-landing `<slug>/rss.xml`, `jobs-data.json` and a per-landing
   `<slug>/jobs-data.json`, `mcp-index.json` plus one `mcp-jobs/<slug>.json`,
   and the OG images (`og/<slug>.png`, `og/cluster/<cluster>.png`,
   `og-default.png`). **Re-derive this list from what you found in steps 1–2**
   — if a page type exists that isn't named here, audit it and say so in the
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
- Account for `trailingSlash: "ignore"` — naive matching produces false
  positives on the slash-less form. Normalize before comparing. (`base` is `/`
  since the move to frontierroles.com, so there is no path prefix to strip.)
  Skip fragment-only hrefs — the skip link's `#main` is on every page, and a
  naive normaliser reports it as one "slash-less" link per page.
- **Use the kept checker:** `python3 -I .claude/skills/audit-site/scripts/check_dist.py site/dist`
  (~15s) sweeps every page for broken links, sitemap ↔ indexable parity,
  canonical targets and chains, JSON-LD parse errors, misplaced JobPosting
  markup, `validThrough` past the age-out, h1 count, duplicate titles and
  descriptions, and feed parse/targets — and exits non-zero on any of them, so
  it doubles as the fix pass's regression gate. Extend it there rather than
  writing a one-off in the scratchpad: cyclearchive rebuilt its equivalent
  twice after losing it with a session.
- **Report your coverage** ("checked 8,412 links across 1,203 pages, 3 broken")
  so a clean result is meaningful. If you sampled rather than swept, say which
  pages and why.

### Rendering at real viewports

§8 (responsive) cannot be done from source. Do this concretely:

```bash
npm run preview -w @aiengjobs/site   # serves dist/ — the artefacts you are auditing
```

Then drive it with the **`claude-in-chrome`** tools. **Don't trust
`resize_window`** — it reports success and leaves the viewport unchanged. Load
each page into a same-origin `<iframe>` of the target CSS width in a throwaway
tab, measure `scrollWidth > clientWidth` inside the frame for overflow, and
screenshot the frames for overlap and truncation (see "Browser tooling" in the
shared conventions for the rest of the gotchas). Sweep the local preview, not
the live site.

**Fallback when the extension isn't connected:** headless Chrome over the
DevTools protocol, driven from Node 24's built-in `WebSocket`. Serve `dist/`
with `python3 -m http.server` (`npm run preview` exited immediately when
backgrounded on 2026-10-08), launch `Google Chrome --headless=new
--remote-debugging-port=<port> --user-data-dir=<scratch>`, then per width
`Emulation.setDeviceMetricsOverride`, evaluate an overflow/tap-target probe
with `Runtime.evaluate`, and `Page.captureScreenshot` what needs eyes.
`scripts/viewports.mjs` does all of this — its header has the launch lines.

If neither is available, **say so explicitly in the report** and mark §8 as
source-only — do not quietly skip it, because layout overflow and overlap are
invisible in source.

## Review dimensions

Work through every dimension below. For each, note what's correct as well as
what's wrong — a clean dimension is a useful result too. **A dimension with
nothing to report gets one line** ("clean — checked X, Y, Z"), not padding.

### 1. Build & correctness

- `astro check` / build errors and warnings; vitest failures.
- The snapshot shape guard in `site/src/lib/data.ts` — does it still match what
  the exporter emits? Silent schema drift between `shared/types.ts`,
  `exportSnapshot.ts`, and the site's assumptions is the classic failure here.
- **Base-path discipline.** The site is served at the apex (`base: "/"`), so a
  hardcoded root-relative path (`href="/…"`, `fetch("/…")`, `url(/…)`) works
  today. The `url()` helper (`site/src/lib/url.ts`) is kept so a move back under
  a path costs nothing — anything that bypasses it is a Low consistency
  finding, not a live bug. Also grep for leftovers of the old home:
  `alastairrushworth.com` or `/aiengjobs` in `site/src/` or `dist/`.
- Rendering logic bugs in page front-matter: filter-count computations
  (`lib/filterOptions.ts`); `getStaticPaths` in `[topic]/[...page].astro`,
  `jobs/[slug].astro`, `companies/[slug]/[...page].astro`,
  `mcp-jobs/[slug].json.ts`, `og/[slug].png.ts`, `[topic]/rss.xml.ts`,
  `[topic]/jobs-data.json.ts` (slug collisions between a city and a cluster,
  jobs in zero clusters, companies with no open jobs); related-jobs selection;
  salary aggregation.
- **One count of the board.** `openJobs` (`lib/data.ts`) is every open
  requisition — the set that gets `/jobs/` pages. `uniqueOpenJobs` folds
  duplicate requisitions into their canonical, and every listing, count, stat,
  payload, feed, landing, company page, the sitemap, `llms.txt` and
  `mcp-index.json` are built from it. Check the homepage count, `/stats`,
  `llms.txt`, `mcp-index.json` and the sitemap's job URLs agree, and that no
  listing shows the same role twice. Visible counts go through `formatCount`
  ("3,523"); machine-read ones (JSON-LD `numberOfItems`, feeds) stay plain
  digits — flag either crossing over.
- Edge inputs: zero open jobs, a job missing `postedAt`/salary/location/
  country, empty filter results, a country code `countryName()` doesn't know,
  fx rates missing a currency. What appears — something sane, or `undefined`?
- **City pages and their country.** Every city page names its country in the
  intro and stats block; a split city (`place.shared` in `buildCityLandings`)
  names it in the h1 and nav label too. Check each country claim — h1, intro,
  "roles in X, Country", the median salary — against the per-country mix of
  the roles actually listed (Cambridge used to file 17 US, 6 GB and 1 unknown
  under "Cambridge, United States" with one blended median).
- **The client-side filter script** (`components/JobFilters.astro`, used by
  the homepage and every landing): the payload arrives from `/jobs-data.json`
  or the landing's own `<slug>/jobs-data.json` via the `data-src` attribute and
  the `dataPromise ??=` fetch, so check the *fetch failure path* — a 404, an
  offline user, a slow response. Does the UI degrade to the server-rendered
  cards with a visible state, or hang/blank? Does the compact payload
  (`lib/jobsPayload.ts`) stay in sync with what `JobCard` renders server-side,
  so filtered results don't look different from initial ones?
- Tombstone behaviour — three kinds, `retired` in `jobs/[slug].astro`:
  closed (description and apply link gone), aged-out (past `MAX_JOB_AGE_DAYS`,
  kept for `AGED_OUT_TOMBSTONE_DAYS`; description and apply link kept) and
  delisted (ruled out of scope; apply link kept, description gone). All
  render a noindexed page (not a 404) with no JobPosting, aren't listed
  anywhere, and their "related jobs" links point only at open roles.
- **Duplicate-job canonicalization**: a duplicate requisition still builds its
  own page; `jobs/[slug].astro` points the canonical at `dupCanonicalSlug`
  (from `duplicateOf()`) and suppresses that page's JobPosting JSON-LD. Verify
  the target exists, is open, isn't itself a duplicate (no canonical
  chains/loops), and that the duplicate is absent from the sitemap and every
  listing.
- 404 page works and is styled — and note that GitHub Pages serves
  `404.html` at the domain root, so its asset/nav links must survive that.
- Entity/encoding correctness: ATS feeds deliver HTML entities and stray markup
  in titles/locations — `decodeEntities` used consistently, nothing
  double-escaped or raw-escaped in visible text.

### 2. Landing pages, pagination & feeds

The largest surface on the site and the core of the programmatic-SEO strategy:
one route (`pages/[topic]/[...page].astro`) and one template
(`components/LandingPage.astro`) serve stack clusters, city pages and remote,
each paginated at `PAGE_SIZE`, each with its own RSS feed and
`jobs-data.json`. Company pages (`pages/companies/[slug]/[...page].astro`)
paginate on the same `PAGE_SIZE` and share the pager
(`components/Pager.astro` + `lib/pager.ts`), so the pagination checks below
apply to both.

**Pagination correctness**
- **Slices ≥2 are noindexed** (`noindex` in `LandingPage.astro` and the company
  route — read the comment there for why) but stay built, linked and followed,
  so every role keeps an in-site path. Each slice should still
  **self-canonicalize**: neither caller passes `canonicalOverride` to
  `Base.astro`, so verify `/<slug>/2/` emits its own URL, not page 1's.
- `rel="prev"`/`rel="next"` (`Base.astro`, from `adjacentPages()` in
  `lib/pager.ts`) — present, absolute, trailing-slash, correct at the first and
  last slice (no `prev` on page 1, no `next` on the last), and matching the
  pager's own Newer/Older links.
- **Differentiated metadata per slice.** `pageSuffix` appends "page N of M" to
  the title (and the landing description adds "Page N of M."). Verify no two
  slices share a title/description.
- `/<slug>/1` must not exist as a duplicate of `/<slug>` — check `dist/` and
  the pager's links agree on one form (`pageHref` in `Pager.astro`).
- The last slice when the count divides exactly; a landing or company with
  exactly one slice (no pager, no prev/next); the landing's empty-state branch
  (`page.data.length === 0`) — can it ever render in a built page, and what
  does it say?
- **Sitemap ↔ built pages parity.** `sitemap.xml.ts` lists page 1 of every
  landing and of every company clearing `companyPageIndexable()` — no slices.
  Diff the sitemap's URL set against `dist/`: every sitemap URL must exist and
  carry no `noindex`, every slice ≥2 must be absent, and every indexable page
  must be present.
- `ItemList` JSON-LD positions (`itemList` in `LandingPage.astro`) must
  continue across slices (`page.start + i + 1`), not restart at 1 on every page.
- Stats block renders only on page 1 (`stats` in `LandingPage.astro`) —
  intended; verify page ≥2 doesn't look broken or empty as a result.

**Landing-page lifecycle — index hygiene**
- City pages publish at `MIN_CITY_JOBS` and are retained down to
  `RETAIN_CITY_JOBS` while open + recently-closed roles still clear
  `MIN_CITY_JOBS` (the engine keeps closed rows 30 days). Verify the hysteresis
  works, then assess the remaining exposure: a city that falls through the
  floor **silently stops being generated** — the URL leaves the sitemap and
  404s with no redirect or 410, after Google has indexed it. How many sit near
  the floor today?
- The inverse: a new city page appearing with thin, near-duplicate copy.
- **Slug collisions** between the city namespace (`ai-jobs-<city>`, a twin's
  `ai-jobs-<city>-<country>`) and cluster slugs — `buildCityLandings` skips a
  taken slug with a `[landings] slug … already taken` build warning, so grep the
  build log. Check `citySlug()` output is stable across refreshes and that a
  split leaves the owner on the bare slug — a slug that changes shape breaks
  every inbound link to it.
- Are city/cluster landings **differentiated** from each other and from the
  homepage — distinct h1, intro, counts, stats block — or thin permutations of
  one job list?

**RSS feeds**
- `rss.xml` (site-wide), `<slug>/rss.xml` (per landing, `[topic]/rss.xml.ts`)
  and `daily/rss.xml` (the day's five, dated by `pickedAt` via `pubDateFor`)
  — verify each builds, is valid RSS 2.0, and is reachable. All three go
  through `buildRssFeed` in `lib/feed.ts`.
- **`daily/rss.xml` reads `site/src/data/daily-picks.json`, which
  `scripts/publish.sh` commits to main nightly.** A branch behind main builds a
  stale daily feed locally — not a production finding. Compare with
  `git show origin/main:site/src/data/daily-picks.json` before reporting it.
- **XML escaping of untrusted feed data.** `xmlEscape` (`lib/feed.ts`) must
  cover every interpolated field — title, company, location, summary, and
  **URLs** — and strip the XML-illegal control characters (`XML_ILLEGAL`). A
  stray `&` or `<` from an ATS title is the classic feed-breaking bug; check a
  built feed parses.
- RFC-822 dates (`rfc822` in `feed.ts`), not ISO 8601 — and what happens when
  `postedAt` is missing or unparseable (it falls back to `ingestedAt`).
- `MAX_ITEMS = 100` — sensible cap; confirm items are newest-first so the cap
  keeps the *right* 100.
- Absolute, base-prefixed URLs in `<link>`/`<guid>`; stable `guid`s across
  refreshes (a guid that changes re-notifies every subscriber).
- Discoverability: the `<link rel="alternate">` in `Base.astro` points at the
  *right* feed per page (`LandingPage.astro` passes its `feedHref`).
- Tombstones and duplicate requisitions must not appear in any feed.

### 3. SEO

This is a programmatic-SEO job board; organic search is the distribution
strategy (spec §8). Review it end-to-end. (Pagination and landing-page SEO are
covered in §2 — don't duplicate them here.)

- **JobPosting structured data (Google for Jobs) — the crown jewel.** Every
  open job page emits a `JobPosting` JSON-LD block; validate it against
  Google's required + recommended fields: `title` (role only, no company/
  location stuffing), `datePosted`, `validThrough`, `hiringOrganization`,
  `jobLocation` vs `jobLocationType: TELECOMMUTE` +
  `applicantLocationRequirements` for remote roles, `baseSalary` with correct
  currency/unit/range, `directApply`, `employmentType`. Check the tombstone
  pages do NOT emit JobPosting (a closed job with structured data is a
  guidelines violation), that a `dupCanonicalSlug` duplicate doesn't emit a
  competing JobPosting for the same role, and that a role failing
  `hasUsableLocation` emits none. Spot-check emitted JSON from `dist/` parses
  and is well-typed.
- **`validThrough`** is min(`generatedAt` + 30 days, `postedAt` +
  `MAX_JOB_AGE_DAYS`) — the board stops listing a role on the second date, so
  claiming validity past it lands a searcher on a tombstone. Count the built
  JobPostings whose `validThrough` exceeds `datePosted` + `MAX_JOB_AGE_DAYS`:
  it should be 0 (774 of 3,358 were, before the cap on 2026-10-08).
- **`addressLocality` vs `locationRaw`.** The locality comes from the
  canonicalized `city`; read it against the posting's own location string —
  "Washington - Seattle Campus" reads broad→narrow and means Seattle, not a
  city called Washington — and a wrong locality is a wrong Google for Jobs
  location. Trace defects to
  `engine/src/pipeline/location.ts` / `shared/city.ts`.
- **Other JSON-LD:** `WebSite` + `ItemList` on the homepage, a per-slice
  `ItemList` on landings, `Organization` + `BreadcrumbList` on company page 1
  only, `BreadcrumbList` on job pages — valid, non-duplicative, consistent
  URLs, and every block routed through `jsonLdScript()`.
- **Titles & descriptions:** unique, present, sensibly-lengthed on **every page
  type in your Step 0.5 sample**. Watch for pages inheriting the generic default
  description in `Base.astro`, and for near-duplicate titles between a cluster
  landing and a city landing that lists mostly the same roles.
- **Canonicals & the trailing-slash story:** `Base.astro` canonicalizes to the
  trailing-slash form (what GitHub Pages actually serves; slash-less 301s).
  Verify sitemap URLs, internal links, feed links, and canonicals all agree — a
  sitemap or nav full of 301s wastes crawl budget. The final domain is
  `https://frontierroles.com`: `site` config, canonicals, OG URLs, feed links
  and JSON-LD `@id`s must all use it. The old `alastairrushworth.com/aiengjobs/*`
  URLs 301 via a Cloudflare redirect rule on that zone — spot-check that a deep
  old URL lands on its *own* new page, not the homepage.
- **Sitemap** (`site/src/pages/sitemap.xml.ts`): every indexable URL present
  (home, stats, `mcp/`, page 1 of every landing, page 1 of every company
  clearing `MIN_INDEXED_COMPANY_ROLES`, every role in `uniqueOpenJobs`);
  nothing noindexed, no slice ≥2, no tombstone, no duplicate requisition;
  `lastmod` values sane (job `updatedAt ?? postedAt` fallback, validated by
  `day()`); companies whose last job just closed drop out cleanly. Note the
  total URL count and whether it's approaching the 50k/50MB limit that would
  require a sitemap index.
- **robots.txt** (`site/src/pages/robots.txt.ts`): coherent with the sitemap;
  sitemap URL absolute and base-prefixed. Should `jobs-data.json` be crawlable?
- **Indexability:** `noindex` belongs on the three tombstone kinds, 404,
  landing and company slices ≥2, and company pages under
  `MIN_INDEXED_COMPANY_ROLES` — nowhere else. Duplicate requisitions
  canonicalize rather than noindex. Nothing real accidentally noindexed, and
  nothing that *should* be noindexed left open.
- **Open Graph / Twitter cards:** per-page title/description/url. Job pages
  get a generated card (`ogImagePath` in `lib/og/policy.ts`): their own if
  posted within `OG_CARD_MAX_AGE_DAYS` or announced by the daily feed, else
  their first cluster's (`og/cluster/<cluster>.png`); every other page,
  landings included, takes `og-default.png`. Check a generated card renders
  (not blank, no overflowing title), every card is 1200×630 and not bloated,
  and `og:image` points at a card that exists in `dist/`.
- **Freshness signals:** "Updated {date}", `lastmod` in the sitemap, feed
  `pubDate`s, `datePosted`/`validThrough` in JobPosting — all derive from
  `generatedAt` or the role's own dates; verify they agree and behave when the
  snapshot is stale (`lib/data.ts` warns past 2 days and fails the build past
  5 unless `ALLOW_STALE_SNAPSHOT=1`).
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
- **Pagination a11y:** the pager (`components/Pager.astro`, on landings and
  company pages) needs an accessible name, current-page indication
  (`aria-current`), and link text that isn't bare "← Newer / Older →" or a bare
  digit out of context (it carries `sr-only` "Page N of M." and "Page " text —
  verify it renders).
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
- **Pagination** was the fix for a 652KB / 15k-node landing (the `PAGE_SIZE`
  comment in `landings.ts`), and company pages adopted it after Capital One
  reached 126KB (the comment atop `companies/[slug]/[...page].astro`). Verify
  the fix holds: measure the busiest landing's and company's page-1 HTML size
  and DOM node count, and confirm no page type has quietly regressed to
  rendering an unbounded list.
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
- **Landing copy** (`lib/clusters.ts` for stacks, `buildCityLandings` in
  `lib/landings.ts` for cities): the city intro is templated — read several
  rendered ones and judge whether they read as written-for-humans or as
  mail-merge. Check a split city's pair reads as two distinct places (h1,
  intro, nav label each naming its country), and that counts in copy match
  counts on the page.
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
- Read **every** `@media` query and the layout primitives that drive reflow
  (`grep -rn @media site/src`): `global.css` (700px and 480px), plus the scoped
  `<style>` blocks — today `JobFilters.astro` and `LandingStats.astro` (700px),
  `Pager.astro` (560px/420px), `AtAGlance.astro` and `PayBenchmark.astro`
  (520px), and `stats.astro` (700px/420px). For each breakpoint ask: what
  changes, and is there a width *between* breakpoints where the layout goes awkward? Flag breakpoint
  inconsistency across files as a maintainability finding.
- Render each page type from your Step 0.5 sample at ~360px, ~390–414px,
  ~768px, ~1024px, ~1280px, ~1600px+ — portrait and landscape for phone sizes.

**Failure modes to hunt for, on every page type:**
- **Horizontal overflow at ~360px:** long unbroken strings are endemic to job
  data — long titles, company names, location strings, salary ranges, skill
  tags; wide stat tables/charts need overflow wrappers; nothing forces sideways
  scroll.
- **Filter bar reflow:** the search input, the work-location toggle and the
  seniority/country/city selects behind the "More filters" disclosure
  (`FilterControls.astro`) wrap gracefully at intermediate widths and stay
  usable.
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
  collide at 420px.
- **Typography & zoom:** base size legible on mobile; **inputs ≥16px** (the
  search input — iOS auto-zooms below that); layout survives 200% zoom without
  horizontal scroll.
- **Hover-only affordances:** anything shown on `:hover` has a touch equivalent.

Tag every responsive finding with the viewport(s) it affects (e.g. `≤480px`,
`768–1024px`, `≥1600px`) so it's reproducible.

### 9. Security hygiene (rendered output)

`audit-code` owns whether the guards are correctly *implemented*; this section
owns whether they're **used everywhere they must be** — the attack surface is
untrusted ATS feed data reaching a rendered page. The deep pass — live headers
and TLS, the MCP server, CI secrets, DNS, the Cloudflare account, consent —
belongs to **`audit-security`**: flag it here in one line, don't review it.

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
  threshold and a page per employer, each paginated (slices ≥2 noindexed).
  What stops that growing into thousands of thin URLs, and are
  `MIN_CITY_JOBS` / `MIN_INDEXED_COMPANY_ROLES` still the right levers at 5×
  the job count?
- Single source of truth: site URL/base (astro.config ↔ url.ts ↔ sitemap ↔
  robots ↔ engine's `config.ts`), brand strings, the cluster taxonomy
  (`shared/taxonomy.ts` ↔ `lib/clusters.ts`), `PAGE_SIZE` (shared by the
  landing and company routes — verify no other pager hardcodes 50; the
  homepage's server-rendered `INITIAL = 50` is a separate knob).
- The snapshot contract: is `SiteSnapshot` the *only* interface between engine
  and site, and does anything on the site silently depend on engine
  implementation details (e.g. city-name canonicalization it doesn't control)?
- Scalability: what breaks first as jobs grow 5×–10× — `jobs-data.json` size,
  build time (N job pages × related-jobs scan), sitemap URL count, the number
  of city landings, filter UX?
- Resilience: what does the site do when the nightly refresh stops — how stale
  can it get before it's actively harmful (wrong "posted X days ago", expired
  `validThrough`, ghost jobs on a "no ghost jobs" board)? The build-time guard
  in `lib/data.ts` stops a build past 5 days — but GitHub Pages keeps serving
  the last good build, so what still ages the live site?
- The domain move (to the frontierroles.com apex, `base: "/"`) is done. Would
  the site survive moving back under a path — i.e. does everything still go
  through `url()`? Low priority; say so in one line either way.

### 11. Search Console & analytics (via the browser)

Google Search Console (the frontierroles.com property) and GA4
(`G-F8NGE6G65G`) are the only external evidence of how the site is actually
crawled and used. The apex is DNS-only at Cloudflare, so there is **no edge
analytics for the site** — only for the MCP Worker. Read GSC and GA4 in the
browser on a full audit, or whenever the user asks about traffic or indexing.

**Start from the baseline, don't re-derive it.**
- **Impressions collapsed on 2026-08-24**, three days after Google's August
  2026 spam update finished rolling out (18–21 Aug): from ~800–1,000/day to
  ~30–50/day. No manual action, no security issue, sitemap read fine, job pages
  200 with valid JobPosting markup. It reads as an algorithmic demotion of a
  programmatic aggregator (thousands of ATS-copied pages, deep paginated
  landings, one-role company pages). Site changes from 21–22 Aug were checked
  and ruled out.
- **Indexing API pings are accepted and ignored** (checked 2026-09-17): 592
  `URL_UPDATED` + 759 `URL_DELETED` over nine nights, all HTTP 200, and the
  sampled URLs were still "URL is unknown to Google". Discovery crawl ~0/day
  since 24 Aug; total crawl ~300–450/day, 85% refresh, 13–20% on 404s of closed
  roles. Indexed ~1.9K, not indexed ~3.9K, "Discovered – currently not indexed"
  ~2.7K. Job Postings report: 3 valid items (peak ~95 around 20 Aug). The
  service account is a delegated Owner, so it isn't permissions.
- **So recovery is a content-quality problem, not a technical-SEO bug hunt**:
  fewer thin or duplicative URLs in the sitemap, more unique value per page
  (the rule-based "At a glance" facts, pay benchmark and company hiring panels
  shipped 2026-09-17 are that bet). Judge any new finding against that frame,
  and don't recommend sending more pings — more quota would not help.

**Reading GSC.**
- **GSC reports the last crawl, not the current state.** `curl -sI` every URL
  from a GSC error list before chasing it; on cyclearchive most were already
  healthy.
- Drill-down reports are addressable, which beats clicking a virtualised
  table: `…/search-console/index/drilldown?resource_id=<property>&item_key=<key>`.
  Keys that worked on cyclearchive's property (confirm here): 404 `CAMYDSAC`,
  soft 404 `CAMYDiAC`, 5xx `CAMYEyAC`, robots `CAMYByAC`, redirect `CAMYCyAC`,
  noindex `CAMYCCAC`, canonical `CAMYGCAC`, crawled-not-indexed `CAMYFyAC`,
  discovered-not-indexed `CAMYFiAC`. Re-`navigate` between reports.
- **Working as designed — do not "fix":** "Blocked by robots.txt" for `/*?`
  filter URLs, `/mcp-jobs/` and `jobs-data.json` (`robots.txt.ts` explains
  each); "Excluded by noindex" for the tombstones, landing and company slices
  ≥2 and one-role company pages; "Alternate page with
  proper canonical" for duplicate postings consolidated by `duplicateOfIn`;
  "Page with redirect" for slash-less and `www` variants and the old
  `alastairrushworth.com/aiengjobs/*` URLs.
- **The real lever is crawl budget** — the not-indexed pile is overwhelmingly
  "Discovered". Levers: fewer, stronger URLs in the sitemap; `lastmod` that
  only moves when content does; internal links to the pages that matter.

**Reading GA4.** The tell for bot traffic is engagement, not volume: a spike
of 100%-new users with zero engaged sessions from one country and one browser
bucket is a headless sitemap walk, not readers (cyclearchive saw exactly this
from Singapore). GA4 deep links can land on the wrong property — check the
property id in the URL after every navigation before reading a number.

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
| Search Console / GA4  |  | indexed vs not, impressions trend vs baseline |

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

The shared report rules apply (one finding per issue, a pattern reported once
with all its locations, honest uncertainty, `→ audit-code` / `→ audit-ui`
one-liners, offer to fix or save — never write files unasked). Specific to this
audit:

- For layout/responsive findings, name the affected viewport(s) (e.g. `≤480px`)
  and whether it's mobile, desktop, or both, so they're reproducible.
- If a problem is data/engine-generated, say so and point at `engine/src/…`,
  not at `snapshot.json`.
- Google for Jobs guideline calls you can't test live get "needs verification".
  State plainly anything you couldn't run — no snapshot, no browser.
- Save target: `audits/audit-site-<date>.md`.

Parallel `Explore` fan-out is available for broad location-gathering ("every
`set:html` usage", "every internal link that bypasses `url()`", "every page's
title/description", "every landing's rendered h1") — see the shared conventions.
