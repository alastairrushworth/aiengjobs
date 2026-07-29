---
name: audit-all
description: Run the full three-layer audit sweep of aiengjobs in one pass — source quality (audit-code), rendered output and SEO (audit-site), and hands-on design/UX in a real browser (audit-ui) — against a single shared baseline, then merge the three into one deduplicated, globally-ranked report. Use when the user wants everything reviewed at once: "full audit", "audit everything", "complete review of the project", "audit the whole thing", "code and site and UI". For a single layer, use the individual skill instead — audit-code for source, audit-site for rendered output and SEO, audit-ui for design critique. Read-only by default; produces one unified report with the three underlying reports attached.
---

# Full Audit — aiengjobs

Runs all three audit lenses against **one shared baseline** and merges the
results. This is the only skill that can answer "what are the most important
problems with this project, across everything" — the individual audits each see
a third of the picture and can't rank against each other.

**Read `.claude/audit-conventions.md` first.** Everything in it applies to this
sweep too.

## When to use this instead of a single audit

| The user wants | Skill |
|---|---|
| Everything, in one pass | **audit-all** (this one) |
| Source quality, security, tests | `audit-code` |
| Rendered output, SEO, a11y, feeds | `audit-site` |
| Design, layout, journey friction | `audit-ui` |

This sweep is expensive — three deep audits plus a browser walkthrough. If the
user named a single layer, run that skill directly. If they said "audit the
site", that's ambiguous between `audit-site` and this one: ask which, in one
line, rather than guessing.

## Why this exists

Two things this skill does that the three can't do for themselves:

1. **One baseline, three lenses.** Left to themselves, each audit fetches the
   snapshot and builds independently — three builds, and potentially three
   *different* snapshots if a refresh lands mid-sweep. Findings then disagree
   about a site that no longer exists. This skill builds once and hands the same
   artefacts to all three.
2. **Global ranking.** Each audit ranks within its own lens. A 🔴 in audit-code
   and a 🔴 in audit-ui are not the same priority to a person deciding what to
   do on Saturday morning. Only a merge stage can order them against each other,
   and only a merge stage can see that three lenses are describing one root
   cause.

## Step 1 — Establish the shared baseline

Do this **in the main thread, once**, before dispatching anything.

```bash
npm run snapshot:fetch               # gitignored — required on a fresh clone
npm run typecheck                    # engine tsc --noEmit + astro check
npm test                             # vitest run
npm run build -w @aiengjobs/site     # full build → site/dist/
```

Then start a server for the browser pass and leave it running:

```bash
npm run preview -w @aiengjobs/site   # serves dist/ — same artefacts the others audit
```

Record, because every downstream agent gets these rather than re-deriving them:

- snapshot `generatedAt` and its age in days (see the freshness rule in the
  conventions — a stale snapshot is itself a top finding)
- typecheck / test / build results, and build time
- page count in `dist/`, sitemap URL count, `dist/index.html` and
  `dist/jobs-data.json` sizes
- the landing set actually generated (clusters + cities + remote), from `dist/`
- `git status` and `git log --oneline -20` — uncommitted work changes what's
  fair to flag

**If the build fails**, stop and report that. A failed build is the finding;
don't dispatch three audits against a broken tree.

## Step 2 — Dispatch audit-code and audit-site in parallel

Both are read-only and context-hungry. Run them as **two concurrent
`general-purpose` subagents, in a single message**, so each gets its own full
context window.

Each prompt must contain:

- The instruction to invoke its skill via the `Skill` tool and follow it in
  full, without abridging.
- The baseline numbers from Step 1, verbatim.
- **"The baseline is already established. Do NOT run `npm run build`,
  `npm run snapshot:fetch`, or anything else that writes to `site/dist/` or
  `site/src/data/` — a concurrent sibling agent is reading those exact files.
  Read `dist/` freely; never regenerate it."** This matters: two concurrent
  builds into one `dist/` will corrupt both audits.
- The return contract: *"Return your complete report as your final message, in
  the format your skill specifies. It is a data payload for a merge stage, not
  a message to a human — no preamble, no sign-off."*
- Read-only reinforcement: *"Do not edit any file."*

A dead subagent returns nothing. If one comes back empty or truncated, say so in
the report rather than papering over a missing third of the sweep.

## Step 3 — Run audit-ui in the foreground

**Do not fan this one out.** It drives the user's real Chrome through the
`claude-in-chrome` extension, and the extension blocks `localhost` until the
user grants permission — a step that needs them present and watching. A
backgrounded agent that hits the permission wall just stalls.

So: after the two subagents are dispatched, invoke `audit-ui` yourself in the
main thread against the preview server from Step 1. Ask for the `localhost`
permission grant up front, before the first `navigate`.

If the user can't or won't grant it, **skip audit-ui and say so plainly in the
final report** — don't substitute a source-only guess at design quality. The
other two audits still stand on their own.

## Step 4 — Merge

You now have up to three reports. The merge is the actual deliverable; the three
reports are its evidence.

1. **Find the shared root causes.** The same underlying defect often surfaces
   in all three lenses wearing different clothes — a swallowed fetch error is a
   code finding, a degraded-state finding, and "dead air after clicking a
   filter". Collapse those into **one** finding that names all three symptoms.
   This is the single highest-value thing this skill does; do it properly rather
   than concatenating.
2. **Re-rank globally.** Build one ordered list across all three lenses using
   the shared severity tiers. Ask of each finding: *what does it actually cost,
   and who pays?* A 🟢 nit from one audit does not outrank a 🟠 from another
   just because its own report listed it first.
3. **Name the cross-cutting themes.** Three or four sentences on what the sweep
   says about the project as a whole — where quality is concentrated, where it's
   thin, and whether the three lenses agree.
4. **Keep every finding.** Merging is deduplication and ranking, never
   truncation. If the merged list is long, that's the honest result.

### Output

```
# Full Audit — aiengjobs (<date>)

## Summary
<6–10 sentences: overall health across all three layers, whether the lenses
agree, the biggest cross-cutting theme, and the single most important fix.>

## Baseline
snapshot generatedAt: <date, N days old>  ·  typecheck: <r>  ·  tests: <r>
build: <pass/fail, time>  ·  pages in dist: <n>  ·  sitemap URLs: <n>
index.html: <size>  ·  jobs-data.json: <size>
lenses run: code ✅ / site ✅ / ui ✅|skipped (<reason>)

## Cross-cutting themes
<3–5 bullets. Each names a pattern seen through more than one lens, with the
lenses that saw it.>

## Global top 10
<one ordered list across all three audits — the actual worklist. For each:
title · severity · lens(es) · one-line cost · `file:line` or page@viewport.>

## Full findings by lens
### Code   — <n findings: n🔴 n🟠 n🟡 n🟢>
### Site   — <n findings: …>
### UI     — <n findings: …>
<each lens's complete report, verbatim, below its heading.>

## What's already good
<merged across all three — the patterns worth protecting.>

## If you only do three things
<the three highest-leverage changes across the whole project, in order.>
```

## Wrap-up

- Stop the preview server you started in Step 1.
- Offer to (a) fix a chosen subset, or (b) save the merged report to
  `audits/audit-all-<date>.md` with the UI screenshots alongside. **Do not
  write files unasked.**
- If the user picks findings to fix, do them one logical change at a time,
  re-running typecheck + tests + build after each.
