-- ============================================================================
-- Opportunity Analyzer AI — portable schema (SQLite + PostgreSQL)
-- Conventions: TEXT uuid ids · SMALLINT 0/1 booleans · TEXT ISO-8601 UTC dates ·
--              TEXT JSON payloads · all access parameterised.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------- auth -----
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT,                 -- null for OAuth-only accounts
  name                TEXT NOT NULL DEFAULT '',
  role                TEXT NOT NULL DEFAULT 'candidate',
  status              TEXT NOT NULL DEFAULT 'active',   -- active | suspended | deleted
  email_verified      SMALLINT NOT NULL DEFAULT 0,
  two_factor_enabled  SMALLINT NOT NULL DEFAULT 0,
  auth_provider       TEXT NOT NULL DEFAULT 'password',
  google_subject      TEXT,
  last_login_at       TEXT,
  failed_login_count  SMALLINT NOT NULL DEFAULT 0,
  locked_until        TEXT,
  mfa_required_for_role SMALLINT NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT NOT NULL DEFAULT '',
  ip_address   TEXT NOT NULL DEFAULT '',
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS organizations (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  website           TEXT NOT NULL DEFAULT '',
  verification_domain TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending_verification', -- pending_verification | under_review | verified | suspended
  is_government     SMALLINT NOT NULL DEFAULT 0,
  notes             TEXT NOT NULL DEFAULT '',
  reviewed_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  organization_id             TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  preferred_locations         TEXT NOT NULL DEFAULT '[]',
  preferred_job_types         TEXT NOT NULL DEFAULT '[]',
  salary_min                  INTEGER,
  salary_max                  INTEGER,
  currency                    TEXT NOT NULL DEFAULT 'INR',
  timezone                    TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  date_format                 TEXT NOT NULL DEFAULT 'indian',
  notify_deadline             SMALLINT NOT NULL DEFAULT 1,
  notify_new_match            SMALLINT NOT NULL DEFAULT 1,
  notify_exam                 SMALLINT NOT NULL DEFAULT 1,
  notify_browser              SMALLINT NOT NULL DEFAULT 0,
  notify_email                SMALLINT NOT NULL DEFAULT 0,
  digest_daily                SMALLINT NOT NULL DEFAULT 0,
  digest_weekly               SMALLINT NOT NULL DEFAULT 1,
  browser_push_subscription   TEXT,
  scoring_weights             TEXT,          -- JSON override of default match weights
  updated_at                  TEXT NOT NULL
);

-- -------------------------------------------------------------- resume -----
CREATE TABLE IF NOT EXISTS resumes (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  extension      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  sha256         TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  storage_encrypted SMALLINT NOT NULL DEFAULT 0,
  text_length    INTEGER NOT NULL DEFAULT 0,
  malware_scan   TEXT NOT NULL DEFAULT 'not_run',   -- not_run | clean | infected | unavailable
  parse_status   TEXT NOT NULL DEFAULT 'pending',   -- pending | parsing | parsed | failed
  parse_error    TEXT,
  is_active      SMALLINT NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id           TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  -- resume-derived (never invented)
  full_name           TEXT,
  professional_title  TEXT,
  career_objective    TEXT,
  total_experience_years REAL,
  location            TEXT,
  preferred_locations TEXT NOT NULL DEFAULT '[]',
  industry            TEXT,
  date_of_birth       TEXT,
  age_years           REAL,
  salary_expectation  TEXT,
  contact_redacted    SMALLINT NOT NULL DEFAULT 1,
  raw_sections        TEXT NOT NULL DEFAULT '{}',
  -- AI-inferred (always carries confidence)
  career_level        TEXT,
  job_families        TEXT NOT NULL DEFAULT '[]',
  strongest_skills    TEXT NOT NULL DEFAULT '[]',
  missing_skills      TEXT NOT NULL DEFAULT '[]',
  transferable_skills TEXT NOT NULL DEFAULT '[]',
  career_paths        TEXT NOT NULL DEFAULT '[]',
  industries          TEXT NOT NULL DEFAULT '[]',
  government_categories TEXT NOT NULL DEFAULT '[]',
  exam_categories     TEXT NOT NULL DEFAULT '[]',
  inferences          TEXT NOT NULL DEFAULT '{}',   -- { field: {value, confidence, source} }
  confidence          TEXT NOT NULL DEFAULT '{}',
  analysis_provider   TEXT NOT NULL DEFAULT 'heuristic',
  status              TEXT NOT NULL DEFAULT 'ready',
  user_edited         SMALLINT NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON candidate_profiles(user_id);

CREATE TABLE IF NOT EXISTS education (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  degree        TEXT NOT NULL DEFAULT '',
  degree_level  TEXT NOT NULL DEFAULT '',   -- school | diploma | bachelor | master | doctorate | professional
  specialization TEXT NOT NULL DEFAULT '',
  institution   TEXT NOT NULL DEFAULT '',
  graduation_year INTEGER,
  score         TEXT,
  score_type    TEXT,                       -- percentage | cgpa | gpa
  verified_in_text SMALLINT NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_education_profile ON education(profile_id);

CREATE TABLE IF NOT EXISTS experiences (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  job_title     TEXT NOT NULL DEFAULT '',
  company       TEXT NOT NULL DEFAULT '',
  start_date    TEXT,
  end_date      TEXT,
  is_current    SMALLINT NOT NULL DEFAULT 0,
  duration_months INTEGER,
  responsibilities TEXT NOT NULL DEFAULT '',
  achievements  TEXT NOT NULL DEFAULT '',
  domain        TEXT NOT NULL DEFAULT '',
  tools         TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiences_profile ON experiences(profile_id);

CREATE TABLE IF NOT EXISTS skills (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',  -- technical | language | tool | accounting | finance | marketing | hr | management | communication | data | industry
  proficiency TEXT NOT NULL DEFAULT 'stated', -- beginner | intermediate | advanced | stated | inferred
  years       REAL,
  source      TEXT NOT NULL DEFAULT 'resume', -- resume | inferred
  confidence  REAL NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_profile ON skills(profile_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

CREATE TABLE IF NOT EXISTS certifications (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  issuer        TEXT NOT NULL DEFAULT '',
  year          INTEGER,
  skills        TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_certifications_profile ON certifications(profile_id);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  technologies TEXT NOT NULL DEFAULT '[]',
  domain      TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  skills      TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_profile ON projects(profile_id);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'resume',  -- resume | opportunity_query | match_explain | roadmap | chat | digest | optimizer
  provider    TEXT NOT NULL DEFAULT 'heuristic',
  model       TEXT NOT NULL DEFAULT '',
  input_digest TEXT NOT NULL DEFAULT '',
  output      TEXT NOT NULL DEFAULT '{}',
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  latency_ms  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ok',      -- ok | failed | fallback
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_user ON ai_analysis(user_id, kind);

-- -------------------------------------------------------- opportunity ------
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  website     TEXT NOT NULL DEFAULT '',
  careers_url TEXT NOT NULL DEFAULT '',
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  industry    TEXT NOT NULL DEFAULT '',
  trust_score REAL NOT NULL DEFAULT 50,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  domain        TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  tier          SMALLINT NOT NULL DEFAULT 4,        -- 1 official … 4 aggregator/blog
  source_type   TEXT NOT NULL DEFAULT 'secondary',  -- official | secondary | aggregator | social
  is_government SMALLINT NOT NULL DEFAULT 0,
  trust_score   REAL NOT NULL DEFAULT 50,
  flagged       SMALLINT NOT NULL DEFAULT 0,
  flag_reason   TEXT,
  robots_checked SMALLINT NOT NULL DEFAULT 0,
  robots_allows  SMALLINT NOT NULL DEFAULT 1,
  last_checked  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_tier ON sources(tier);
CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain);

CREATE TABLE IF NOT EXISTS opportunities (
  id                  TEXT PRIMARY KEY,
  canonical_key       TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  organization        TEXT NOT NULL DEFAULT '',
  company_id          TEXT REFERENCES companies(id) ON DELETE SET NULL,
  posted_by_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  type                TEXT NOT NULL DEFAULT 'job',   -- job | government_job | exam | internship | apprenticeship | fellowship | graduate_job | contract
  category            TEXT NOT NULL DEFAULT '',
  sub_category        TEXT NOT NULL DEFAULT '',
  job_family          TEXT NOT NULL DEFAULT '',
  locations           TEXT NOT NULL DEFAULT '[]',
  work_mode           TEXT NOT NULL DEFAULT 'onsite',  -- onsite | remote | hybrid | unknown
  employment_type     TEXT NOT NULL DEFAULT 'full_time',
  description         TEXT NOT NULL DEFAULT '',
  responsibilities    TEXT NOT NULL DEFAULT '',
  qualification       TEXT NOT NULL DEFAULT '[]',
  degree_levels       TEXT NOT NULL DEFAULT '[]',
  fields_of_study     TEXT NOT NULL DEFAULT '[]',
  skills              TEXT NOT NULL DEFAULT '[]',
  experience_required TEXT NOT NULL DEFAULT '',
  experience_min_years REAL,
  experience_max_years REAL,
  is_fresher_friendly SMALLINT NOT NULL DEFAULT 0,
  salary              TEXT NOT NULL DEFAULT '',
  salary_min          REAL,
  salary_max          REAL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  vacancies           INTEGER,
  age_min             INTEGER,
  age_max             INTEGER,
  nationality         TEXT NOT NULL DEFAULT '',
  eligibility         TEXT NOT NULL DEFAULT '',
  eligibility_rules   TEXT NOT NULL DEFAULT '{}',
  application_start   TEXT,
  application_deadline TEXT,
  exam_date           TEXT,
  status              TEXT NOT NULL DEFAULT 'open',    -- open | closing_soon | deadline_today | closed | exam_upcoming | admit_card | completed | result | notification_expected | needs_verification | archived
  match_score         REAL NOT NULL DEFAULT 0,
  trust_score         REAL NOT NULL DEFAULT 50,
  quality_score       REAL NOT NULL DEFAULT 50,
  final_score         REAL NOT NULL DEFAULT 0,
  official_source     TEXT NOT NULL DEFAULT '',
  application_url     TEXT NOT NULL DEFAULT '',
  source_urls         TEXT NOT NULL DEFAULT '[]',
  duplicate_group     TEXT,
  duplicate_count     SMALLINT NOT NULL DEFAULT 1,
  conflict_flags      TEXT NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT 'needs_verification', -- verified | needs_verification | suspicious | conflicting
  last_verified       TEXT,
  next_verification   TEXT,
  first_discovered    TEXT NOT NULL,
  source_updated      TEXT,
  expires_at          TEXT,
  is_active           SMALLINT NOT NULL DEFAULT 1,
  is_demo             SMALLINT NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opp_type ON opportunities(type);
CREATE INDEX IF NOT EXISTS idx_opp_deadline ON opportunities(application_deadline);
CREATE INDEX IF NOT EXISTS idx_opp_score ON opportunities(final_score);
CREATE INDEX IF NOT EXISTS idx_opp_group ON opportunities(duplicate_group);

CREATE TABLE IF NOT EXISTS opportunity_sources (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_id       TEXT REFERENCES sources(id) ON DELETE SET NULL,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  snippet         TEXT NOT NULL DEFAULT '',
  tier            SMALLINT NOT NULL DEFAULT 4,
  claims          TEXT NOT NULL DEFAULT '{}',   -- what THIS source asserted (for conflict detection)
  retrieved_at    TEXT NOT NULL,
  source_date     TEXT,
  UNIQUE (opportunity_id, url)
);
CREATE INDEX IF NOT EXISTS idx_oppsrc_opp ON opportunity_sources(opportunity_id);

CREATE TABLE IF NOT EXISTS government_exams (
  id                  TEXT PRIMARY KEY,
  opportunity_id      TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  exam_name           TEXT NOT NULL,
  exam_code           TEXT NOT NULL DEFAULT '',
  organization        TEXT NOT NULL DEFAULT '',
  organization_type   TEXT NOT NULL DEFAULT '',   -- central | state | psu | banking | railway | defence | university | regulatory
  category            TEXT NOT NULL DEFAULT '',   -- ssc | upsc | state_psc | banking | railway | teaching | police | defence | insurance | court | university | research | regulatory
  post                TEXT NOT NULL DEFAULT '',
  qualification       TEXT NOT NULL DEFAULT '[]',
  degree_levels       TEXT NOT NULL DEFAULT '[]',
  fields_of_study     TEXT NOT NULL DEFAULT '[]',
  age_min             INTEGER,
  age_max             INTEGER,
  age_relaxation      TEXT NOT NULL DEFAULT '',
  age_reference_date  TEXT,
  experience_required TEXT NOT NULL DEFAULT '',
  experience_min_years REAL,
  nationality         TEXT NOT NULL DEFAULT '',
  vacancies           INTEGER,
  application_fee     TEXT NOT NULL DEFAULT '',
  notification_number TEXT NOT NULL DEFAULT '',
  notification_date   TEXT,
  application_start   TEXT,
  application_deadline TEXT,
  fee_deadline        TEXT,
  correction_start    TEXT,
  correction_end      TEXT,
  admit_card_date     TEXT,
  exam_date           TEXT,
  exam_end_date       TEXT,
  answer_key_date     TEXT,
  result_status       TEXT NOT NULL DEFAULT 'not_declared',
  answer_key_status   TEXT NOT NULL DEFAULT 'not_released',
  interview_status    TEXT NOT NULL DEFAULT 'not_started',
  final_result_status TEXT NOT NULL DEFAULT 'not_declared',
  status              TEXT NOT NULL DEFAULT 'notification_expected',
  timeline            TEXT NOT NULL DEFAULT '[]',
  eligibility         TEXT NOT NULL DEFAULT '',
  eligibility_rules   TEXT NOT NULL DEFAULT '{}',
  official_notification TEXT NOT NULL DEFAULT '',
  official_application  TEXT NOT NULL DEFAULT '',
  official_website    TEXT NOT NULL DEFAULT '',
  conflict_flags      TEXT NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT 'needs_verification',
  trust_score         REAL NOT NULL DEFAULT 50,
  last_verified       TEXT,
  next_verification   TEXT,
  is_active           SMALLINT NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exams_status ON government_exams(status);
CREATE INDEX IF NOT EXISTS idx_exams_category ON government_exams(category);
CREATE INDEX IF NOT EXISTS idx_exams_deadline ON government_exams(application_deadline);

CREATE TABLE IF NOT EXISTS deadlines (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  exam_id        TEXT REFERENCES government_exams(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'application',  -- application | fee | correction | exam | admit_card | result | interview | custom
  due_at         TEXT NOT NULL,
  remind_before_days SMALLINT NOT NULL DEFAULT 3,
  notified_at    TEXT,
  status         TEXT NOT NULL DEFAULT 'upcoming',     -- upcoming | reminded | passed
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deadlines_user ON deadlines(user_id, due_at);

-- --------------------------------------------------- personalisation -------
CREATE TABLE IF NOT EXISTS saved_opportunities (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  exam_id        TEXT REFERENCES government_exams(id) ON DELETE CASCADE,
  note           TEXT NOT NULL DEFAULT '',
  reminder_at    TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (user_id, opportunity_id, exam_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_opportunities(user_id);

CREATE TABLE IF NOT EXISTS applications (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  exam_id        TEXT REFERENCES government_exams(id) ON DELETE SET NULL,
  title          TEXT NOT NULL DEFAULT '',
  organization   TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'interested', -- interested | to_apply | applied | test_scheduled | interview_scheduled | selected | rejected | withdrawn
  applied_at     TEXT,
  test_at        TEXT,
  interview_at   TEXT,
  interview_info TEXT NOT NULL DEFAULT '',
  result_known   TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  history        TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id, status);

CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  exam_id        TEXT REFERENCES government_exams(id) ON DELETE CASCADE,
  verdict        TEXT NOT NULL,   -- relevant | not_relevant | already_applied | not_eligible | wrong_information
  comment        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, verdict);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL DEFAULT 'in_app',  -- in_app | browser | email
  kind        TEXT NOT NULL DEFAULT 'info',    -- deadline | new_match | exam | digest | system | security
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  payload     TEXT NOT NULL DEFAULT '{}',
  read_at     TEXT,
  sent_at     TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

-- ------------------------------------------------------------- search ------
CREATE TABLE IF NOT EXISTS search_jobs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  profile_id    TEXT REFERENCES candidate_profiles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'queued', -- queued | running | completed | failed | partial
  stage         TEXT NOT NULL DEFAULT 'queued',
  progress      SMALLINT NOT NULL DEFAULT 0,
  steps         TEXT NOT NULL DEFAULT '[]',     -- honest per-step status log
  queries       TEXT NOT NULL DEFAULT '[]',
  providers     TEXT NOT NULL DEFAULT '[]',
  found         INTEGER NOT NULL DEFAULT 0,
  stored        INTEGER NOT NULL DEFAULT 0,
  duplicates    INTEGER NOT NULL DEFAULT 0,
  conflicts     INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_jobs_user ON search_jobs(user_id, created_at);

CREATE TABLE IF NOT EXISTS search_logs (
  id           TEXT PRIMARY KEY,
  search_job_id TEXT REFERENCES search_jobs(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT '',
  query        TEXT NOT NULL,
  tier         SMALLINT NOT NULL DEFAULT 4,
  results      INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok',   -- ok | failed | rate_limited | blocked | robots_denied
  latency_ms   INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_logs_job ON search_logs(search_job_id);

CREATE TABLE IF NOT EXISTS verification_runs (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  exam_id        TEXT REFERENCES government_exams(id) ON DELETE CASCADE,
  checked_fields TEXT NOT NULL DEFAULT '[]',
  agreements     TEXT NOT NULL DEFAULT '[]',
  conflicts      TEXT NOT NULL DEFAULT '[]',
  outcome        TEXT NOT NULL DEFAULT 'needs_verification',
  checked_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_opp ON verification_runs(opportunity_id);

-- -------------------------------------------------------------- admin ------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT NOT NULL DEFAULT '',
  actor_role    TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id   TEXT NOT NULL DEFAULT '',
  previous_value TEXT,
  new_value     TEXT,
  reason        TEXT NOT NULL DEFAULT '',
  ip_address    TEXT NOT NULL DEFAULT '',
  session_id    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS security_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  event       TEXT NOT NULL,   -- login_failed | login_success | logout | role_change | api_key_change | rate_limited | csrf_rejected | unauthorized
  detail      TEXT NOT NULL DEFAULT '',
  ip_address  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_event ON security_logs(event, created_at);

CREATE TABLE IF NOT EXISTS platform_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  is_secret   SMALLINT NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key         TEXT PRIMARY KEY,
  enabled     SMALLINT NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_quality_issues (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,   -- duplicate | conflict | expired | verification_failed | source_failed | missing_official
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  exam_id       TEXT REFERENCES government_exams(id) ON DELETE CASCADE,
  detail        TEXT NOT NULL DEFAULT '',
  severity      TEXT NOT NULL DEFAULT 'info',
  resolved      SMALLINT NOT NULL DEFAULT 0,
  resolved_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dq_kind ON data_quality_issues(kind, resolved);

CREATE TABLE IF NOT EXISTS analytics_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  event       TEXT NOT NULL,
  props       TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event, created_at);

CREATE TABLE IF NOT EXISTS skill_taxonomy (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL DEFAULT 'other',
  aliases     TEXT NOT NULL DEFAULT '[]',
  job_families TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resume_optimizations (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id      TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  score          REAL NOT NULL DEFAULT 0,
  ats_score      REAL NOT NULL DEFAULT 0,
  result         TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resume_opt_user ON resume_optimizations(user_id);
