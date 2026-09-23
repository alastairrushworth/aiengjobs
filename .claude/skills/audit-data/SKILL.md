---
name: audit-data
description: Audit whether the roles frontierroles.com publishes are TRUE to the employer's own posting — is each listed role actually in scope under ml/RUBRIC.md v3 (frontier AI only), and are its title, company name and slug, location/country/city/remote, seniority, salary, posted date, open/closed state, apply link, skills/clusters, extracted "At a glance" posting facts and pay benchmark what the source says. Runs a mechanical pass over snapshot.json (scripts/profile.mjs) and then a stratified, hand-checked sample against the live ATS postings, reporting per-field error rates and tracing every defect to the pipeline stage that produced it. Use when the user asks to audit, spot-check, verify or sanity-check the board's data, listings, classification quality or precision ("is this role really AI?", "are the salaries right?", "why is X listed", "check Adobe's listings", "how accurate is the board"), or after a pipeline, connector or classifier change. This is the data lens: audit-code reviews the pipeline's source, audit-site the rendered pages, and ml/ owns training — this skill measures what they produce, one role at a time. Read-only by default; produces a findings report with measured rates.
---

# Data Audit — frontierroles.com

**Read `.claude/audit-conventions.md` first**, especially **the data
boundary**: `snapshot.json` is engine-generated, never hand-edited. Every
defect this skill finds is fixed in the stage that produced it.

The board's pitch is first-party trust: every role comes straight from the
employer's ATS, nothing sponsored, nothing reposted, apply links to the
employer. This skill checks that promise **role by role**: does what we publish
match what the employer published, and does the role belong on a frontier-AI
board at all? The source of truth is always the **live posting** on the
employer's ATS — never the snapshot, never the classifier score, never general
knowledge about the company.

This is the analogue of cyclearchive's `audit-content` (which checks each
contents entry against the scanned page it came from). It is new: **the first
run will teach it things** — write them into this file, in the section they
belong to, in the same change.

## Scope

| Question | Owner |
|---|---|
| Does this role belong on the board? Is its data right? | **audit-data** |
| Is the pipeline stage that produced it correct *code*? | audit-code |
| Does the page render the (possibly wrong) data correctly? | audit-site |
| Retraining, relabelling, the gold set, threshold choice | `ml/` (see `ml/README.md`) |

A defect found here is reported with its evidence (our value vs the source's)
**and** the stage that produced it. Whether that stage's code is well written
is `→ audit-code`. A classification error is reported as a labelled example;
the fix is a relabel/retrain decision in `ml/`, not a title regex added in
passing.

## Operating rules

- **Read-only.** Findings, not edits. The engine CLI's writing commands
  (`ingest`, `refresh`, `retag`, `relocate`, `reclassify`, `notify`) are off
  limits unless the user asks — `relocate --dry-run` is the only one safe to
  run for evidence.
- **Label scope blind.** Read the posting and decide IN/OUT under
  `ml/RUBRIC.md` v3 *before* looking at `modelScore` — anchoring on the score
  is how a precision check turns into agreement with the model. The rubric's
  standing calls: forward-deployed engineers are IN when the job is building or
  deploying AI systems; traditional business ML (fraud, risk, ranking, recsys,
  pricing) is OUT even when it trains models; label by what the advert means,
  not its exact wording; ambiguous traditional-vs-frontier breaks OUT.
- **One source per role, the employer's.** Prefer the ATS's public JSON API
  (below) over scraping the careers page: it is what the connector read, so a
  difference is ours, not a rendering artefact. Record the source URL you
  checked against for every sampled role.
- **Be polite to the ATSs.** Space requests (≥1 s apart per host). Workable's
  per-job detail endpoint throttles per IP after ~150 requests in a window —
  a 429 there is the host, not a finding.
- **Compare like with like.** The snapshot is a nightly export; a posting
  edited or closed since `generatedAt` is drift, not a defect. Check the
  snapshot's age first and treat anything that changed after it as "moved
  since export" unless it has been wrong for more than a night.
- **Measure, then generalise carefully.** A sample of 40 gives a wide interval.
  Report counts with the stratum they came from, and a Wilson 95% interval for
  any rate you quote. Never extrapolate a rate from one ATS family to another.

## The toolkit

```bash
S=.claude/skills/audit-data/scripts

# PROFILE — mechanical pass over the whole snapshot, <1 s. Reads only the
# snapshot: field coverage, ATS families, classifier bands, and candidate flags.
node $S/profile.mjs
node $S/profile.mjs --company adobe            # one employer (substring of companySlug)
node $S/profile.mjs --sample 40 --seed 7       # + a stratified sample to hand-check
node $S/profile.mjs --json --sample 40         # machine-readable, for a results file
```

- **Listed, not open.** The profile and the sample cover what the site
  *lists* (`listedJobs` in `shared/indexable.ts`: open, dated, ≤90 days old).
  Open roles past 90 days are tombstones by design and are counted, not
  flagged.
- **Bands** (threshold 0.70, `ENCODER_THRESHOLD`): `confident` ≥0.80,
  `boundary` 0.70–0.80, **`title-rescued`** <0.70 — listed anyway because the
  title matched `IN_TITLE_PATTERNS` and the model was not confident enough to
  veto (`ingest.ts`: veto needs `1 − p ≥ ENCODER_VETO_CONFIDENCE`) — the
  richest stratum for scope errors — and `no-score`, rows with no `modelScore`
  (most likely ingested before the field existed and not re-inferred since:
  establish that rather than assume it).
- **Families** come from the apply URL's host. `custom-domain` is an
  employer's careers site fronting an ATS — `?gh_jid=` means Greenhouse
  underneath.
- **Same seed, same snapshot → same sample**, so a re-check after a fix reads
  the same roles.

Other sources:

- **Source postings — the ATS APIs the connectors use** (`engine/src/connectors/`):
  Greenhouse `https://boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>`,
  Ashby `https://api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true`,
  Lever `https://api.lever.co/v0/postings/<org>?mode=json`,
  SmartRecruiters `https://api.smartrecruiters.com/v1/companies/<co>/postings`,
  Workable `https://apply.workable.com/api/v2/accounts/<acct>/jobs/<shortcode>`,
  Oracle `https://<host>/hcmRestApi/resources/latest/…`. Workday, iCIMS,
  Eightfold and SuccessFactors are read from the careers page (WebFetch the
  apply URL). The board slug for each company is in
  `engine/seed/companies.csv` (`name,ats_provider,ats_slug,domain,stage`).
- **The live board through MCP**: the `AI engineering jobs` connector's
  `get_job` / `get_company` / `search_jobs` return what the live site serves
  tonight — the quickest way to see whether a snapshot-era defect is still
  live.
- **Everything the pipeline saw, not just what it published**: `gh release
  download db-latest` (`aiengjobs.db.gz`) holds OUT-classified and closed rows.
  Recall — IN roles the board *dropped* — can only be sampled there.
- **Classifier reference points**: `ml/gold/gold.jsonl` (held-out, hand
  labelled), `ml/acceptance/run.ts` (44 archetypal adverts, exits 1 on any
  wrong side of the threshold), `ml/README.md` (the last measured precision/
  recall, and the caveat that it predates the 3072-token window fix).

## Step 0 — Freshness and profile

```bash
npm run snapshot:fetch            # the published snapshot, from the `snapshot` branch
node .claude/skills/audit-data/scripts/profile.mjs
```

Record: `generatedAt` and its age, listed count, field coverage, family and
band mix. A snapshot more than ~2 days old is itself a finding (see the
conventions) — and makes every live comparison noisier.

**Baseline** (snapshot 2026-09-17, profiled 2026-09-23 — diff against it):
8,288 jobs · 6,555 open · **3,693 listed** · 924 companies. Coverage on listed:
country 96%, city 83%, seniority 62%, `modelScore` 82%, salary 48%. Families:
ashby 1,218 · workday 832 · greenhouse 682 · custom-domain 521 ·
smartrecruiters 192 · lever 191 · the rest <20 each. Bands: confident 2,604 ·
boundary 307 · title-rescued 133 · no-score 649.

## Step 1 — Triage the mechanical flags

Every flag is a **candidate**. Open a few examples of each against the source
before calling it a defect, then report the flag once with its count and the
confirmed share.

| Flag | What it usually is | Where the fix lives |
|---|---|---|
| `company-slug-from-ats-host` | Company slug built from the ATS token, not the company — public URLs like `/companies/adobe-wd5-external-experienced/`. **59 of 924 on the baseline**, all tenant-path providers (Workday `adobe:wd5:external_experienced`, Oracle hosts). The slug also keys company ids and every job slug, so changing it is a migration with a redirect story (`→ audit-site`), not a one-line fix. | `engine/src/seed.ts:90` — `slugify(atsSlug)` |
| `title-carries-reqid-or-location` | Requisition ids (`(R5412)`, `R1000631 …`) or a location suffix left in the title | `engine/src/pipeline/normalize.ts`, `site/src/lib/jobTitle.ts` |
| `title-markup-or-entity` | Entities or tags in a title. Also catches placeholder "roles" (`<insert your dream job here>`) — a general-application posting that should not be listed at all | `normalize.ts`; scope → `ml/` |
| `title-all-caps` | Shouted titles the site could title-case | `jobTitle.ts` |
| `no-country-despite-location` | A location string the parser could not place (`Farringdon`, `LIVONIA 01`, `AMER`) | `pipeline/location.ts`, `shared/city.ts`, `pipeline/region.ts`; `relocate --dry-run` shows what a re-run would fill |
| `city-not-in-location-string` | Mostly **correct canonicalisation** (Bengaluru → Bangalore, RTP → Research Triangle Park). Look for the ones that are *wrong*, not different | `shared/city.ts` |
| `near-duplicate-escapes-consolidation` | The same role twice because the location or title spelling differs ("Santa Clara, CALIFORNIA" / "Santa Clara, California") — `duplicateOfIn` keys on the exact strings | `shared/indexable.ts` dupKey |
| `apply-url-not-https` | Employer serves http; `safeUrl` upgrades it on the site — informational unless the https form fails | none, or the connector |
| `apply-url-aggregator` | A LinkedIn/Indeed link — breaks the first-party promise | connector |
| `salary-*` | Min>max, hourly read as annual, a currency with no FX rate | `pipeline/comp.ts`, `shared/fx.ts` |
| `open-but-unseen` | Not seen for >14 days but still open (`UNSEEN_CLOSE_DAYS`) | `engine/src/db/repo.ts` close rule |
| `posted-in-future` | A feed date in the future | connector date parsing |

## Step 2 — The sampled deep check

```bash
node .claude/skills/audit-data/scripts/profile.mjs --sample 40 --seed <n>
```

40 is the default; raise it for a single family or band the user cares about.
For **each** sampled role, fetch the source posting and record one JSON line in
the scratchpad (`audit-data-<date>.jsonl`), written **as you go** — a long
sample held in memory is lost if the session dies:

```json
{"slug": "...", "stratum": "greenhouse/boundary", "source": "<url checked>",
 "scope": "in|out|unsure", "scope_reason": "one line, rubric terms",
 "modelScore": 0.73, "fields": {"title": "ok|wrong: ours vs theirs", "company": "ok",
 "location": "ok", "remote": "ok", "seniority": "ok|wrong|missing", "salary": "ok|wrong|missing-but-stated",
 "posted": "ok|wrong", "open": "yes|closed-at-source", "apply": "ok|dead|not-first-party",
 "skills": "ok|noisy", "facts": "ok|wrong: <fact>"}}
```

What each field check means:

- **scope** — blind, under RUBRIC v3 (Operating rules). `unsure` is allowed and
  counted separately; don't force it.
- **title / company** — as the employer printed it, modulo our documented
  normalisation. The company *name* and *slug* both.
- **location / remote** — country, city and remote type against the posting's
  own location field. Multi-location postings: we must not have invented a
  single city.
- **seniority** — only where the posting states or unambiguously implies it;
  "missing" is fine, "wrong" is the finding.
- **salary** — a stated range we failed to parse is `missing-but-stated`
  (a coverage defect on a salary-transparent board); a parsed range that
  disagrees with the text is `wrong` — check currency and period especially.
- **posted** — against the ATS's own date. Only Greenhouse, Ashby and Lever
  give a true first-publication date; SmartRecruiters, Workday and Teamtailor
  dates are republish or scrape artefacts. Judge those against what the source
  exposes, not against the ideal.
- **open** — a closed-at-source role we still list, allowing one night of
  drift. **apply** — resolves (not 404, not a generic careers page) and is on
  the employer's ATS.
- **skills / clusters** — noisy tags are expected; report only a tag that
  misfiles the role (an LLM role filed only under "cloud").
- **facts** — every "At a glance" row `site/src/lib/postingFacts.ts` extracted
  for this role (experience, education, visa, clearance, office days, travel,
  equity, relocation, languages …): find the sentence it came from and confirm
  it says that. A regex fact that is wrong is worse than a missing one — it
  sits in the panel above the description *and* in JobPosting markup.

Then, across the sample:

- **Precision by band and family**: IN / labelled, with a Wilson 95% interval.
  `title-rescued` and `no-score` are the bands to watch; `confident` should be
  near-perfect, and if it is not, that is the headline.
- **Per-field error rate**, with the stage each error traces to.
- **Recall** needs `db-latest`: sample OUT-classified rows near the threshold
  (0.5–0.7 with an ambiguous title) and label them the same way. Optional —
  say whether it was done.

## Step 3 — Derived content

Two things the site computes from the data deserve their own check, because
they read as the board's own claims:

- **Posting facts at scale.** For each fact type, sample ~10 roles where it
  fired (from the built pages or by running `postingFacts()` over the
  snapshot's `descriptionText` in a scratch script) and measure precision per
  type. A type below ~90% is a finding against `postingFacts.ts`. Types that
  fire on boilerplate (EEO text, benefits footers) are the usual culprit.
- **Pay benchmark and company hiring.** The benchmark's pool tier (country +
  level → country → level → worldwide) must be the one the page says; a
  worldwide pool carries a "mostly US pay" caveat. `Company.hiring.openPostings`
  is only meaningful for full-board connectors — not Workday, Oracle, iCIMS,
  Eightfold or SuccessFactors, which are keyword-searched — and days-to-close
  only for Greenhouse, Ashby and Lever. A company page showing either for the
  wrong provider is a finding (`exportSnapshot.ts` holds the provider lists).

## Output — the report

```
# Data Audit — frontierroles.com (<date>)

## Summary
<3–6 sentences: how trustworthy the board is on this sample, the biggest
defect class, and the single most important fix.>

## Baseline
snapshot generatedAt: <date, N days old>  ·  listed: <n>  ·  companies: <n>
sample: <n> roles, seed <s>, strata <list>  ·  recall sample: <n | not run>
flags: <top five with counts>

## Measured
| | n | correct | rate (95% CI) |
|---|---|---|---|
| Scope — confident | | | |
| Scope — boundary | | | |
| Scope — title-rescued | | | |
| Scope — no-score | | | |
| Title / company / location / seniority / salary / posted / open / apply / facts | | | |

## 🔴 Critical   (listing out-of-scope roles at scale, dead or third-party apply links, wrong pay)
## 🟠 High        (a field wrong often enough to mislead: salary, location, a posting fact)
## 🟡 Medium      (coverage gaps, near-duplicates, ugly slugs and titles)
## 🟢 Low / Nits  (cosmetic normalisation)

For each finding:
- **<short title>** — <count / rate>  ·  _<field>_
  - Evidence: 2–3 roles, ours vs the source (`slug` · source URL).
  - Stage: `engine/src/…` or `site/src/lib/…` — the fix goes there.
  - Recommended fix, and whether it needs a backfill (`retag`, `relocate`, a
    re-ingest) or only affects new roles.

## What's already solid
## If you only do three things
```

The shared report rules apply. Specific to this audit: every rate carries its
n and interval; every example carries the source URL checked; a
classification finding is framed as labelled examples for `ml/`, never as "add
this title to a regex". End by offering to (a) fix a chosen subset at the
pipeline stage, (b) append the labelled scope decisions to a file `ml/` can
use, or (c) save the report to `audits/audit-data-<date>.md`. Don't write
files unasked — the scratchpad JSONL is the exception, and it stays in the
scratchpad.

## Subagents

Checking 40+ postings by hand is the slow part and parallelises cleanly. If
you fan out, the brief is **per role and self-contained** — the slug, the
source URL to fetch, the JSONL line's shape, the RUBRIC v3 summary above, and
"write `unsure` rather than guess" — never "read the SKILL.md". Each agent
**appends one line per finished role** to its own file so a relaunch can skip
finished work. Ask the user for the concurrency first, state the role count,
and spot-check what comes back against the source before counting it: agents'
labels are data, not truth.
