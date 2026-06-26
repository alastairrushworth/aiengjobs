# AI Engineering Jobs — Product & Technical Spec (v0.1)

> A niche job board for **AI engineers** — the people shipping LLM-powered applications, RAG pipelines, agents, evals, and inference in production. Web-first, salary-transparent, no ghost jobs, organized around the modern AI-engineering stack rather than generic "AI/ML" tags.
>
> This is a working spec to build from. It is opinionated. Change anything; the data-acquisition section is the part you should not skip.

---

## 1. Positioning & thesis

**One-line:** The job board that speaks fluent AI engineering — RAG, agents, evals, inference — so the right candidates self-select and the right companies look credible.

**Why this wedge (the bet):**
- AI Engineer is the fastest-growing job title in the market (LinkedIn 2026 ranked it #1, ~143% YoY posting growth; title-level ~74% YoY vs ~33% for ML Engineer).
- No incumbent owns it. Existing boards (aijobs.net, aijobs.ai, Jobtensor) are all broad "AI/ML/data science." None is *the* place for AI engineers specifically.
- It's a distinct identity with a distinct stack (LLM apps, RAG, vector stores, tool-use, inference APIs) — a taxonomy generic boards don't model.
- >75% of AI-engineering postings require domain specialists, so audience self-identification is strong.

**The honest risks (design around these):**
- ~67% skill overlap with ML Engineer → scope must blur edges deliberately (see §4) or you exclude jobs people want.
- Title still "trendy"/unstandardized → don't hard-gate on the literal string "AI Engineer"; classify by *skills + responsibilities*.
- Listings are a commodity (everyone can pull the same ATS feeds) → **the moat is taxonomy + curation + salary data + audience, not the listings.**

**Differentiators (the only things that matter):**
1. **Stack-native taxonomy** — browse by RAG, agents, evals, vector DBs, inference/serving, fine-tuning, not just "AI."
2. **Salary transparency** — show comp wherever the source exposes it; filter by it. (Ashby feeds carry the cleanest comp data — lean on it.)
3. **No ghost jobs** — every listing traces to a live first-party ATS posting; auto-expire when it disappears at source.
4. **A weekly newsletter** — the owned distribution channel and the real long-term asset.

---

## 2. Target users

**Candidates (the audience — non-paying, drives traffic):**
- Working AI/ML/software engineers moving into LLM-application work.
- Profile: mid-to-senior (entry-level is <6% of postings — don't position as an early-career board).
- They care about: tech stack, model environment, whether it's real AI dev vs. "AI tool usage," remote policy, comp.

**Customers (who pays):**
- **LLM-first startups** — your primary seed supply *and* first paying customers; overwhelmingly on Greenhouse/Lever/Ashby.
- **Consultancies/enterprises** standing up AI practices (PwC, Accenture-type demand).
- **Technical recruiters/agencies** hiring for AI-infra/LLM roles that sit open >90 days.

---

## 3. Monetization (build the hooks in from day one)

Sequenced — do not build all of this for MVP, but design the data model so these slot in:

1. **Paid job postings** — $99–$299/post, 30–60 day duration. Primary revenue. (MVP: just need a Stripe checkout + a `posting` that's `source = direct`.)
2. **Featured/promoted upsell** — +$50–$150 to pin/highlight/boost. Pure margin.
3. **"Claim your job" flow** — companies whose roles are auto-listed from ATS feeds can claim + upgrade to a featured direct post. Warm first sale.
4. **Employer subscriptions** — $199–$499/mo for bundled/unlimited posts. Add *after* ~20 repeat per-post buyers.
5. **Resume/candidate database access** — $150–$500/mo, later, once candidate-side liquidity exists.
6. **Newsletter sponsorship** — sponsored slots/featured roles to a targeted list. High value per impression.

**Floor math:** $1,000 MRR ≈ ~33 customers @ $30, ~20 @ $50, or ~7 paid posts @ $150. Niche boards convert ~3–5% vs ~2% general; a high-value niche monetizes at 5k–10k monthly visitors (vs 50k+ for general).

---

## 4. Scope — role taxonomy (what's IN vs OUT)

**Classification principle:** classify by skills + responsibilities, not the literal job title. A "Software Engineer, LLM Platform" is in; a "Data Analyst" is out even if it says "AI" somewhere.

### IN (core)
- AI Engineer / GenAI Engineer / LLM Engineer / LLM Application Engineer
- AI/ML Engineer where the role is application/integration-focused
- RAG / retrieval engineer
- AI Agents / agentic systems engineer
- Inference / model-serving / LLMOps engineer
- Applied AI / Forward-deployed AI engineer
- AI infra / GenAI infrastructure engineer (GPU, serving, latency)
- Fine-tuning / model-adaptation engineer
- AI eval / model-quality engineer
- Prompt engineering **only when** bundled into a build role (pure prompt roles are thin)

### IN (adjacent — include to avoid an artificially thin board)
- MLOps / ML Platform engineer
- ML Engineer (production/applied flavor)
- AI-focused full-stack/backend roles (clearly shipping AI features)

### OUT (keep the board credible)
- Data Analyst / BI / Data Engineer (unless explicitly AI-platform)
- Pure Data Scientist / Research Scientist (separate identity; optional future vertical)
- "AI" sales/marketing/PM roles (optional separate non-eng section later)
- "AI tool user" roles with no engineering (e.g., "use ChatGPT to write copy")
- Generic SWE with a token "AI a plus"

### Skill-tag taxonomy (the browse/facet structure — your differentiator)
Group facets so the site reads as stack-native:

- **LLM & frameworks:** OpenAI/Anthropic APIs, LangChain, LlamaIndex, DSPy, vLLM, Hugging Face
- **Retrieval/RAG:** vector DBs (Pinecone, Weaviate, pgvector, Qdrant, Milvus), embeddings, reranking
- **Agents:** tool-use, multi-agent, orchestration, MCP
- **Evals & quality:** eval harnesses, LLM-as-judge, observability (LangSmith, Arize, etc.)
- **Inference/serving:** GPU, Triton, TensorRT, quantization, latency/throughput
- **Fine-tuning:** LoRA/PEFT, RLHF/DPO, distillation
- **Core ML:** PyTorch, TensorFlow, deep learning, NLP, CV
- **MLOps/infra:** Kubernetes, Docker, Ray, Kubeflow, SageMaker/Vertex/Azure ML, CI/CD for models
- **Cloud:** AWS, Azure, GCP
- **Languages:** Python (table stakes), TypeScript/JS, Go, Rust, C++
- **Cross-cutting:** seniority, remote policy (remote/hybrid/onsite), location/region, salary band, company stage

---

## 5. Core features

### MVP (ship in ~2 weeks)
- Job index with the §4 facets (filter by skill cluster, seniority, remote, salary, location).
- Job detail page → links to the **real** first-party apply URL (no middleman apply).
- Auto-ingested listings from ATS feeds (see §6) — board looks full on day one.
- Salary shown wherever the source exposes it.
- Auto-expiry when a job disappears from source.
- Email job alerts (saved search → email; replaces the need for a native app).
- Programmatic SEO pages (see §8).
- Stripe checkout for a paid/featured direct post.
- Newsletter signup + first issue.

### Fast-follow
- "Claim this job" upgrade flow.
- Employer dashboard (manage posts, see views/clicks).
- Company profiles (aggregate a company's AI roles + stack).
- Web push for alerts (PWA).
- Saved jobs / candidate accounts (precursor to resume DB).

### Later
- Employer subscriptions, resume database, market-insights/trends pages (powered by your own ingested data — a real proprietary-data asset).

---

## 6. DATA ACQUISITION (the core of this spec)

The cold-start problem is the thing that kills job boards. For an AI-engineering board it's unusually tractable because your target employers — AI startups and tech-forward firms — overwhelmingly publish roles through **public, no-auth ATS endpoints**. Strategy: **seed automatically from ATS feeds → enrich/classify → dedupe → keep fresh → layer paid direct posts on top.**

### 6.1 Primary source: public ATS JSON/XML feeds (free, no auth)

These are the same endpoints that power companies' own careers pages. First-party, fresh the moment a role opens, real apply links, no anti-bot.

**Greenhouse** (easiest to start; widest tech coverage)
```
GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
# also: https://api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
```
- Returns title, location, departments, offices, content (HTML description), updated_at, absolute_url (apply link).
- No source-side keyword/location filtering — pull all, filter yourself.
- `{board_token}` is the company slug (e.g. a company's greenhouse board name).

**Lever** (good source-side filters)
```
GET https://api.lever.co/v0/postings/{company}?mode=json
# optional params: &team=&department=&location=&commitment=&level=&skip=&limit=
```
- Honor `robots.txt` `Crawl-delay: 1` (1 req/sec per host).
- `{company}` is the Lever site slug.

**Ashby** (cleanest compensation data — prioritize for salary transparency)
```
GET https://api.ashbyhq.com/posting-api/job-board/{board_name}?includeCompensation=true
```
- Comp often present as structured JSON-LD. This is where your salary filter gets its best data.
- Common in newer high-growth/LLM-first startups — i.e. your exact target companies.

**Workable**
```
GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true
# (also account-specific published-jobs endpoints; verify per account)
```
- More common outside the VC-startup world (SMBs/agencies). Lower priority for this niche but easy to add.

**Recruitee** (EU SMB/mid-market)
```
GET https://{company}.recruitee.com/api/offers/
```

**Personio** (DACH/Europe; XML feed)
```
GET https://{company}.jobs.personio.de/xml
```

> **Coverage reality:** Greenhouse + Lever + Ashby will cover the large majority of US/EU AI-first startups. Add Workable/Recruitee/Personio for breadth. For ATSes with no public feed (Workday is messy, many enterprises), either skip, parse the careers page, or buy via an aggregator (§6.6).

### 6.2 Reference implementations to study
- `plibither8/jobber` (GitHub) — minimal API wrapping Ashby/Greenhouse/Lever/BambooHR. Good schema reference.
- Public ATS-endpoint write-ups (e.g. cavuno.com, fantastic.jobs) document exact endpoints and quirks per ATS.

### 6.3 Building the seed company list (the real work)
The feeds are keyed by company slug, so your job is curating **which companies** to poll. Aim for 200–500 to start.

Sources for the company list:
- Hand-curated list of AI labs + well-funded LLM/AI startups (your domain knowledge is the edge here).
- YC company lists, AI-focused VC portfolio pages (a16z, Sequoia, Index, etc.).
- Funding-announcement feeds (filter for AI/ML).
- GitHub orgs of notable AI tooling companies.
- Cross-reference: for each company, detect which ATS they use (try each endpoint with their slug; auto-detect from `careers.{domain}` redirects).

Store the company list as first-class data (see §7 `Company` / `Source`) so you can grow it continuously and track which ATS + slug each uses.

### 6.4 Enrichment & classification pipeline (your moat lives here)
Raw feeds are a commodity. The processing is the value-add. For each ingested job:

1. **Normalize** to one schema across ATSes (title, company, location, remote flag, description, comp, apply URL, posted/updated timestamps).
2. **Classify IN/OUT** (§4) — keyword + skills heuristics first; an LLM classifier for edge cases. Store a confidence score; low-confidence → review queue.
3. **Tag skills** against the §4 taxonomy — extract from title + description (RAG, agents, vector DBs, PyTorch, etc.). An LLM pass does this well and cheaply at this volume.
4. **Infer seniority** (intern → staff/principal) from title + stated experience.
5. **Normalize comp** — parse salary_min/max/currency/period; prefer structured (Ashby JSON-LD), regex fallback for Greenhouse/Lever.
6. **Remote classification** — remote / hybrid / onsite + region constraints.
7. **Company enrichment** — stage, domain, logo, short description.

Keep LLM cost in check: classify/tag on **ingest only**, cache by content hash, and skip re-processing unchanged postings. At this volume the cost is trivial, but cap it.

### 6.5 Deduplication, freshness & expiry
- **Dedup key:** normalize on (company + normalized_title + location) and/or apply-URL; collapse the same role appearing across multiple sources.
- **Change detection:** store a content hash per job; only re-process on change.
- **Freshness:** poll nightly (hourly for a small "hot" set if you want). Most ATS feeds reflect new roles immediately.
- **Expiry (the "no ghost jobs" promise):** if a job vanishes from its source feed on the next poll, mark `is_closed` and de-list. This is a core differentiator — enforce it.
- **New/closed diffing:** track `is_new` and `is_closed` between runs to power "new this week" + the newsletter.

### 6.6 Fallback / accelerator: aggregators (optional, paid)
If you'd rather not build/maintain every parser:
- **Apify ATS actors** — pull Greenhouse/Lever/Ashby/Workable/etc. into one normalized schema; ~$0.005/job pay-per-result, or flat ~$11/mo unlimited career-page actors. Good for breadth or a fast start.
- **Unified.to** — one API across 60+ ATS (incl. Workday, SmartRecruiters); heavier, more B2B.
- Recommendation: **build Greenhouse/Lever/Ashby yourself** (a weekend; owning it is the long-term call), use an aggregator only to extend into ATSes without public feeds.

### 6.7 Direct (paid) postings
Separate ingestion path: an employer form → Stripe → a `posting` with `source = direct`, `featured = true/false`. These rank above aggregated listings and never auto-expire from feed logic (they expire on their paid duration). This is the revenue layer sitting on top of the free seed supply.

### 6.8 Legal / ToS / ethics (read before scraping anything)
- Job-posting data (title, description, comp, apply link) is generally treated as **public factual information**, and aggregation is broadly accepted.
- **Use the official public ATS feeds.** Respect each company's ToS and any `robots.txt` crawl-delay (e.g. Lever's 1 req/sec).
- **Do NOT scrape LinkedIn or Indeed** — their terms prohibit it; rely on first-party ATS feeds and direct posts instead.
- **Never** ingest candidate/personal data or any gated content. Only public postings.
- Always link out to the employer's real apply page; don't intercept applications in MVP.

---

## 7. Data model (starting point)

```
Company
  id, name, slug, domain, ats_provider (greenhouse|lever|ashby|workable|recruitee|personio|direct)
  ats_token, stage, size, logo_url, description, created_at

Source            # how/where a job was acquired
  id, company_id, ats_provider, endpoint_url, last_polled_at, status

Job
  id, company_id, source_id
  title, normalized_title
  description_html, description_text
  apply_url
  location_raw, country, region, city
  remote_type (remote|hybrid|onsite)
  seniority (intern|junior|mid|senior|staff|principal|lead|manager)
  salary_min, salary_max, salary_currency, salary_period
  classification (in|out), classification_confidence
  is_featured, is_direct, is_new, is_closed
  posted_at, updated_at, ingested_at, expires_at
  content_hash

JobSkill          # many-to-many, the taxonomy facets
  job_id, skill_id

Skill
  id, name, cluster (llm|rag|agents|evals|inference|finetuning|core_ml|mlops|cloud|language)

EmployerOrder     # paid posts
  id, company_id, job_id, stripe_payment_id, plan, amount, starts_at, ends_at, status

Subscriber        # newsletter + alerts
  id, email, saved_search_json, frequency, confirmed_at

User              # later: candidate/employer accounts
  id, email, role (candidate|employer|admin), ...
```

---

## 8. SEO / GEO architecture (web-first acquisition)

Discovery is the whole game and it's a web game (an app would amputate it). Build programmatic pages **on your proprietary, enriched data** — not thin templates (those are dead post-2024/2026 Google updates).

Page types (each a real, useful, indexable page):
- `/{skill}-jobs` — e.g. `/rag-engineer-jobs`, `/llm-engineer-jobs`, `/ai-agents-jobs`
- `/{skill}-jobs/{location}` — e.g. `/llm-engineer-jobs/remote`, `/ai-engineer-jobs/london`
- `/companies/{company}` — a company's AI roles + stack profile
- `/salaries/{role}` — comp pages built from your ingested salary data (genuinely proprietary; survives AI search as a "data publisher")
- `/{role}-jobs/{seniority}` — e.g. `/ai-engineer-jobs/senior`

Notes:
- Lead with data only you have (live counts, salary distributions, trending skills) so pages aren't commodity content.
- Optimize for **GEO** too (being cited by ChatGPT/Perplexity/AI Overviews), not just blue links — structured data (JobPosting schema.org), clear factual summaries.
- The newsletter is the channel you *own* and is resistant to search-traffic erosion — prioritize it early.

---

## 9. Suggested stack (adjust to taste)

- **Framework:** Next.js (App Router) — SSR/SSG for SEO, API routes for ingestion, one codebase, easy PWA for push alerts.
- **DB:** Postgres (+ `pgvector` if you want semantic search/dedup later). Use it for full-text search initially; add a dedicated search index only if needed.
- **Ingestion:** scheduled jobs (cron / Vercel Cron / a small worker). Idempotent, content-hash-gated.
- **Classification/tagging:** an LLM API call on ingest (cheap at this volume), cached by content hash.
- **Payments:** Stripe Checkout + webhooks.
- **Email:** a transactional + newsletter provider (alerts + weekly issue).
- **Hosting:** keep infra cost ~$85–200/mo range; this is a low-ops product.

---

## 10. Build roadmap

**Phase 0 — Validate (days):** landing page, define the role scope (§4), put up a waitlist + "pay $1 / pre-order a featured post" CTA. Post in 1–2 AI-engineering communities. Threshold to proceed: ~20 signups (or ~10 pre-pays) in 2 weeks.

**Phase 1 — Seed + index (weekend):** Greenhouse + Lever + Ashby ingestion for a hand-curated list of ~100–300 AI-first companies. Normalize + classify + tag. Public job index with facets. Auto-expiry.

**Phase 2 — SEO + alerts + first revenue (week 2):** programmatic pages (§8), email alerts, Stripe featured-post checkout, newsletter issue #1.

**Phase 3 — Convert supply (weeks 3–6):** "claim your job" flow, employer dashboard, company profiles. Start selling featured posts to LLM-first startups already in your index.

**Phase 4 — Stack the model:** subscriptions (after ~20 repeat buyers), resume DB, salary/trends data pages.

**Kill/scale thresholds:** sunset if <$500/mo after ~6 months of real distribution effort; double down if it clears ~$1,000 MRR with <5% monthly churn.

---

## 11. Open questions to decide before building
1. **Scope width:** strict "AI engineer" or include MLOps/ML-platform/applied-ML from day one? (Recommend: include adjacents, label clearly, so the board isn't thin.)
2. **Geography:** global, or US-anchored first? (US is ~34–44% of postings; global gives more volume.)
3. **Salary-first identity:** make comp transparency the headline brand promise (leaning on Ashby data)? It's a strong, defensible differentiator.
4. **Newsletter cadence/voice:** who writes issue #1, and what's the recurring hook (new roles + one hiring-trend insight)?
5. **Build vs. buy ingestion:** self-built GH/Lever/Ashby (recommended) vs. Apify accelerator for v0?

---

## Sources for the data-acquisition facts
Endpoint formats and ATS coverage: public ATS API documentation and write-ups (Greenhouse `boards-api.greenhouse.io`, Lever `api.lever.co/v0/postings`, Ashby `api.ashbyhq.com/posting-api`), `plibither8/jobber`, cavuno.com and fantastic.jobs ATS-endpoint guides, Apify ATS aggregator actors, Unified.to. Market/demand figures: LinkedIn 2026 Jobs on the Rise, InterviewStack.io (May 2026 posting/salary comparison), research.com, 365 Data Science, Acceler8 Talent. Verify endpoints against each provider's current docs before relying on them in production.