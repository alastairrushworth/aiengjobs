-- aiengjobs data model (spec §7). SQLite (WAL). System of record on the droplet.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  domain        TEXT,
  ats_provider  TEXT NOT NULL,
  ats_token     TEXT,
  stage         TEXT,
  size          TEXT,
  logo_url      TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- How/where a job was acquired (one per company+provider feed).
CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ats_provider   TEXT NOT NULL,
  endpoint_url   TEXT NOT NULL,
  last_polled_at TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS jobs (
  id                        TEXT PRIMARY KEY,
  company_id                TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id                 TEXT REFERENCES sources(id) ON DELETE SET NULL,
  external_id               TEXT,                       -- the ATS's own posting id
  slug                      TEXT NOT NULL UNIQUE,
  title                     TEXT NOT NULL,
  normalized_title          TEXT NOT NULL,
  description_html          TEXT,
  description_text          TEXT,
  apply_url                 TEXT NOT NULL,
  location_raw              TEXT,
  country                   TEXT,
  region                    TEXT,
  city                      TEXT,
  remote_type               TEXT,                       -- remote|hybrid|onsite
  seniority                 TEXT,                       -- intern..manager
  salary_min                REAL,
  salary_max                REAL,
  salary_currency           TEXT,
  salary_period             TEXT,                       -- year|month|day|hour
  classification            TEXT NOT NULL DEFAULT 'out',-- in|out
  classification_confidence REAL,
  is_featured               INTEGER NOT NULL DEFAULT 0,
  is_direct                 INTEGER NOT NULL DEFAULT 0,
  is_new                    INTEGER NOT NULL DEFAULT 1,
  is_closed                 INTEGER NOT NULL DEFAULT 0,
  posted_at                 TEXT,
  updated_at                TEXT,
  ingested_at               TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at                TEXT,
  content_hash              TEXT,                       -- change detection (skip reprocessing)
  dedup_key                 TEXT,                       -- company + normalized_title + location
  last_seen_at              TEXT                        -- last poll that still listed this job
);

CREATE INDEX IF NOT EXISTS idx_jobs_company        ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_classification ON jobs(classification);
CREATE INDEX IF NOT EXISTS idx_jobs_closed         ON jobs(is_closed);
CREATE INDEX IF NOT EXISTS idx_jobs_dedup          ON jobs(dedup_key);
CREATE INDEX IF NOT EXISTS idx_jobs_apply_url      ON jobs(apply_url);
CREATE INDEX IF NOT EXISTS idx_jobs_source_ext     ON jobs(source_id, external_id);

CREATE TABLE IF NOT EXISTS skills (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  cluster TEXT NOT NULL                                  -- ClusterId
);

CREATE TABLE IF NOT EXISTS job_skills (
  job_id   TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, skill_id)
);

-- Paid direct posts (spec §6.7).
CREATE TABLE IF NOT EXISTS employer_orders (
  id                TEXT PRIMARY KEY,
  company_id        TEXT REFERENCES companies(id) ON DELETE SET NULL,
  job_id            TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  stripe_payment_id TEXT,
  plan              TEXT,
  amount            INTEGER,
  starts_at         TEXT,
  ends_at           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
);

-- Newsletter + job alerts (spec §7).
CREATE TABLE IF NOT EXISTS subscribers (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  saved_search_json TEXT,
  frequency         TEXT NOT NULL DEFAULT 'weekly',
  confirmed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Candidate/employer accounts (later phases).
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'candidate',          -- candidate|employer|admin
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
