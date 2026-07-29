---
name: audit-ui
description: Drive the running aiengjobs site in a real Chrome browser and review it as a designer would — visual hierarchy, layout, typography, spacing, colour, interaction quality, affordance clarity, journey friction, empty/loading/error states, and how it actually feels to use on a phone and a laptop. Walks representative journeys (browse → filter → evaluate a role → apply, plus landing pages, pagination, salaries and dead ends), clicking through real pages rather than reading source. Use when the user asks for a UI review, UX audit, design critique, "how does the site feel", "what could look better", or wants improvements to layout and usability. Correctness, SEO and a11y compliance belong to audit-site; source quality belongs to audit-code. For a full sweep across source, rendered output and UI together, use audit-all instead. Produces a prioritized, screenshot-backed improvement report; read-only (does not edit files unless asked).
---

# UI/UX Audit — aiengjobs

**Read `.claude/audit-conventions.md` first.** It carries the rules shared by
all three audit skills — the scope split, operating rules, severity tiers and
report rules. This file adds only what's specific to a hands-on design review.

A **hands-on design review**: open the site in a real browser, use it the way a
job seeker would, and judge how it looks and feels. This is the skill that
answers "what would make this nicer to use?" — not "is it broken?"

You cannot do this from source. Source tells you what *should* render; only
clicking through tells you that the filter bar feels cramped at 900px, that the
salary column is the first thing your eye lands on when it shouldn't be, or that
nothing happens for 400ms after you click "show all". **Click, scroll, hover,
type, and look.**

## Scope boundary

See the split table in the shared conventions. The seam with `audit-site` is
worth being precise about here, because both look at rendered pages:

- **audit-site asks "does it break?"** — horizontal overflow at 360px, tap
  targets under 44px, contrast below WCAG AA, a missing label, a 404.
- **audit-ui asks "does it work well?"** — is the hierarchy right, is the
  density comfortable, is the affordance obvious, does the journey flow, does it
  look considered.

A cramped-but-functional filter bar is yours. A filter bar that overflows the
viewport is audit-site's. When you find a hard defect (broken layout, unreadable
contrast, a dead link), still report it — flag it `→ also audit-site` so it
isn't lost, and keep going.

Never review source files in this skill. If a fix obviously lives in one file,
name it; don't go reading the codebase.

## Operating rules

The shared rules in `.claude/audit-conventions.md` apply — read-only, evidence
for every finding, smallest change that fixes it, taste labelled as taste.
Specific to a design review:

- **Judge as a job seeker, not as a developer.** The user is someone scanning
  for a role on their phone during a commute, or comparing three postings on a
  laptop. Their goals: *is there anything good here, is it recent and real, does
  it pay, can I apply.* Every finding should trace back to one of those.
- **Respect the existing design language.** This is a deliberately minimal,
  text-dense, fast job board — system font stack, small CSS, no framework, no
  imagery beyond icons. **Do not propose a visual overhaul**, a component
  library, an illustration set, or a brand refresh. Recommend the *smallest*
  change that fixes the problem within the current aesthetic. You may propose at
  most **one** bigger bet, clearly labelled as such, at the end.
- **Evidence is a screenshot.** The shared "cite evidence" rule cashes out here
  as an image, saved to disk (`save_to_disk: true`) and attached in the report.
  "The spacing feels off" with no image is not a finding.
- **Count the cost.** Where you can, quantify friction: clicks to complete a
  journey, scroll depth to the first useful thing, seconds to interactive.
- **Don't trigger dialogs.** No `alert`/`confirm` paths, nothing that opens a
  browser modal — it freezes the extension for the rest of the session.

## Setup

Start the site (see Prerequisites in the shared conventions for the snapshot):

```bash
npm run dev -w @aiengjobs/site      # → http://localhost:4321/aiengjobs/
```

`npm run preview` against `dist/` also works and is closer to production; dev is
fine for UI work and rebuilds as you go.

### Grant the browser permission first — this will bite you

The Claude in Chrome extension blocks `localhost` by default. The first
`navigate` returns **"This site is blocked by your site permissions"**. Fix it
before doing anything else:

> Ask the user to open the Claude in Chrome extension, go to site permissions,
> and allow `localhost` (or `localhost:4321`). It takes them ten seconds. Retrying
> the navigation without the grant will just fail again.

If the user can't or won't grant it, **say so plainly and stop** — this skill has
no meaningful source-only fallback. Offer `audit-site` instead, which covers
layout defects from built HTML.

### Tool sequence

1. `tabs_context_mcp { createIfEmpty: true }` — always first, once per session.
2. `resize_window` to set the viewport before screenshotting.
3. `browser_batch` for multi-step sequences (navigate → screenshot → click →
   screenshot). Batching is much faster than one call per action — use it for
   every journey below.
4. `computer` for `screenshot`, `left_click`, `scroll`, `hover`, `type`, `zoom`.
   Use `zoom` on a region to inspect small things (badge contrast, icon
   alignment) rather than squinting at a full-page capture.
5. `read_page { filter: "interactive" }` to see the control inventory and
   tab order of a page.
6. `get_page_text` when reviewing copy — easier to read than a screenshot.

**Viewports.** Do the whole walkthrough at **390×844** (phone) and **1440×900**
(laptop). Spot-check **768×1024** (tablet — the awkward middle where the filter
bar and card grid reflow) and **1920×1080** (wide — where a capped container can
leave the page looking marooned). Job seekers browse heavily on phones, so when
desktop and mobile disagree, **mobile wins**.

## The walkthrough

Do these as journeys, not as a page checklist — the point is to feel the seams
*between* pages. Take a screenshot at every numbered step, and note anything
that made you hesitate.

**Discover the exact URLs first**: the landing set is data-driven and changes
every refresh. Pull real slugs off the homepage rather than assuming any of the
example URLs below still exist.

### Journey A — "Is there anything here for me?" (the 5-second test)

1. Land on `/aiengjobs/`. **Before scrolling**, screenshot and answer: what is
   this site, who is it for, and what should I do next? If you can't tell in
   five seconds, that's the most important finding on the page.
2. Squint at the screenshot (or `zoom` out): what does the eye hit first,
   second, third? Is that the intended order — value proposition → job count →
   the jobs themselves?
3. Scroll the full homepage. Note where the "meat" starts, how much vertical
   space the hero and filter bar consume before the first job card, and whether
   the card list has a comfortable rhythm or runs together.
4. Assess a single `JobCard` in isolation (`zoom` in): is the title clearly the
   primary element? Is salary findable? Do company, location, remote status and
   the "new" badge compete with each other or nest cleanly? Are the skill tags
   useful at a glance or visual noise?

### Journey B — "Show me the ones I want" (filtering)

5. Use the filter bar as a user: type in the search box, then change the role,
   country and seniority selects, then change the sort. Screenshot after each.
6. **Watch what happens on first interaction** — the full job list is fetched
   lazily from `/jobs-data.json`. Is there any loading indication, or does the
   page sit still and then jump? Time it roughly. A silent multi-hundred-
   millisecond gap after a click is a real UX finding.
7. Do the results update visibly? Is the result count obvious and does it move
   where you'd look for it? Do client-rendered cards look **identical** to the
   server-rendered ones, or is there a subtle shift in spacing/format?
8. Drive filters into a **zero-result** state. Screenshot. Is the empty state
   helpful — does it say why and offer a way back — or is it a blank void? Is
   there an obvious "clear filters" affordance, and did you have to hunt for it?
9. Try the filter bar at 390px and at 768px. Does it stay usable, or does it
   become a stack of full-width selects you scroll past to reach any job?

### Journey C — "Tell me about this role" (evaluate → apply)

10. Click a job card. Was the whole card clickable, or only the title? (Hover
    first — is the clickable region signposted?)
11. On the job page, screenshot above the fold at both widths. Can you find
    salary, location, seniority and the apply button without scrolling? On the
    phone, how many scrolls to reach **Apply**?
12. Read the description block: line length, paragraph rhythm, heading
    treatment, and how ATS-authored HTML actually renders (feed markup is
    inconsistent — look for cramped bullet lists, orphaned headings, walls of
    unbroken text).
13. Assess the apply button: does it look like the primary action, is it obvious
    it leaves the site, and is it reachable from the bottom of a long description
    without scrolling back up?
14. Check the related-jobs section: is it a useful next step or an afterthought?
15. Go **back**. Did the site return you to your place in the list, or dump you
    at the top with your filters cleared? This is one of the most common and
    most annoying job-board failures — test it deliberately.

### Journey D — "Browse by topic and place" (landing pages + pagination)

16. Visit a cluster landing (e.g. `/aiengjobs/ai-agent-jobs`) and a city landing
    (e.g. `/aiengjobs/ai-jobs-london`). Screenshot both.
17. Assess the stats block (page 1 only): are the tiles scannable, is the median
    salary given useful context, do the top-companies and top-skills lists earn
    their vertical space or push jobs below the fold?
18. Go to page 2 (`/ai-agent-jobs/2`). **The stats block is absent by design** —
    does page 2 feel intentional, or does it feel like a broken version of page
    1? Does the header still tell you where you are?
19. Use the pager (← Newer / Page N of M / Older →). Is your position clear? Are
    the targets comfortable on a phone? Is "Newer/Older" the right mental model
    here, or would numbered pages serve better on a 20-page landing?
20. Follow the `BrowseNav` cross-links at the bottom. Do they feel like a
    considered next step or a link dump? Is the RSS link doing useful work in
    that position?

### Journey E — Salaries, stats and the edges

21. `/aiengjobs/salaries` → a cluster page. Are the percentile figures (p10 /
    median / p90) legible to a non-analyst? Is it obvious what population
    they describe and how many roles back them?
22. `/aiengjobs/stats`. Are the charts readable on a phone? Do labels collide?
    Is there a takeaway, or just data?
23. A **closed-job tombstone** (find one by following a stale link, or ask the
    user for a slug). Does it explain what happened and offer somewhere to go?
24. The **404** page (visit any bad path). Same question.
25. Finally: header, footer and navigation coherence across everything you
    visited. Does the nav tell a consistent story about what the site contains?

## Review dimensions

Organize what you saw against these. Skip nothing, but a dimension with nothing
to report gets one line.

### 1. First impression & information hierarchy
The 5-second test result. What the eye lands on in what order, on each page
type. Whether the most valuable thing (the jobs) is reachable without wading.
Whether the site reads as trustworthy, current and maintained — this is a board
whose pitch is "real, salary-transparent, no ghost jobs", and the design has to
carry that claim.

### 2. Layout, spacing & rhythm
Vertical rhythm and consistency of spacing between sections; alignment and grid
discipline; density (this board is deliberately dense — is it *comfortably*
dense or *cramped*?); the container width and how it behaves at 1920px; scannability
of long card lists; whether related things are visually grouped and unrelated
things separated.

### 3. Typography
Hierarchy through size/weight/colour rather than decoration; heading scale
consistency across page types; line length on job descriptions (the longest-form
content on the site); line height and paragraph spacing; how titles behave when
they're very long — a real and constant condition with ATS data.

### 4. Colour, contrast & visual language
The palette's coherence and how much work it's doing; whether the "new" badge,
salary, remote and seniority signals are visually distinguishable at a glance
without shouting; muted-text legibility; link/visited/hover/focus treatments;
whether dark mode exists and, if not, whether it's worth it for this audience.

### 5. Interaction & affordance
Do clickable things look clickable (cards, tags, pager, crumbs)? Hover and focus
feedback. What happens *between* click and result — loading, skeleton, or dead
air (Journey B step 6 is the key one). Whether state changes are visible.
Keyboard usability as an *experience*, not a compliance check.

### 6. Journey friction
For each journey above: number of clicks, scroll depth, and every point where
you hesitated. Back-navigation state preservation (step 15). Dead ends. Places
where the obvious next action isn't offered.

### 7. Content & microcopy design
Not the words' accuracy (that's audit-site) but their *design*: labels that
carry their weight, counts and dates presented usefully, empty/error states that
say something, button text that describes its action, and whether the templated
city-landing copy reads as written-for-humans across several examples.

### 8. Mobile experience
Not "does it overflow" (audit-site) but "is this pleasant on a phone": thumb
reach for primary actions, how much screen the header and filters consume before
content, tap-target comfort and spacing, scroll length of a listing page, and
whether anything meaningful depends on hover.

### 9. States: empty, loading, error, edge
Zero results. First-interaction fetch. A role with no salary on a
salary-transparent board. A landing's last page with three roles. Tombstone.
404. These are where products feel unfinished, and they're cheap to fix.

### 10. Polish
Alignment nits, inconsistent corner radii or border weights, icon sizing,
favicon and touch icons, the page title in the tab, scroll-position jumps, layout
shift as content loads. Individually trivial; collectively they're most of the
difference between "hobby project" and "considered product".

## Output — the report

```
# UI/UX Audit — aiengjobs (<date>)

## Summary
<4–6 sentences: how the site feels to use, its strongest design quality, the
biggest source of friction, and the single highest-leverage improvement.>

## What I did
Viewports: <list>  ·  Pages visited: <n>  ·  Journeys completed: A–E
<one line on anything you couldn't test and why.>

## 🔴 High friction   (blocks or badly slows a core journey; users bounce)
## 🟠 Notable         (real irritation or confusion; costs engagement)
## 🟡 Refinement      (clarity, hierarchy, consistency wins)
## 🟢 Polish / taste  (nits and preferences — labelled as preference)

For each finding:
- **<short title>** — <page type> @ <viewport>
  - What I saw (with screenshot attached)
  - Why it costs the user something
  - Smallest change that fixes it, within the current design language

## What's already working
<brief and specific — the design decisions worth protecting from a future
redesign.>

## If you only do three things
<the three highest-leverage changes, in order, with the effort each implies.>

## One bigger bet (optional)
<at most one larger design change, clearly framed as a bet, with the case for
and against.>
```

The shared report rules apply (one finding per issue, a pattern reported once
with every page it appears on, `→ also audit-site` / `→ audit-code` one-liners,
offer to fix or save — never write files unasked). Specific to this audit:

- Attach screenshots for visual findings; a finding without evidence is an
  opinion.
- Tag every finding with the **page type and viewport** where you saw it, so
  it's reproducible.
- Be honest about subjectivity. Design has taste in it — say when a call is
  taste, and give the reasoning rather than asserting.
- Save target: `audits/audit-ui-<date>.md`, with its screenshots.

## Wrap-up

Stop the dev server when you're done if you started it.
