# Opportunity Analyzer AI

**Upload Your Resume. Discover Your Next Opportunity.**

Opportunity Analyzer reads a resume, builds a structured career profile, searches for jobs and
Indian government examinations the person is actually eligible for, matches and ranks them, and
tracks every deadline until the application closes.

```
RESUME → AI PROFILE → SEARCH → MATCHING → DEADLINE TRACKING → EXAM STATUS → RECOMMENDATIONS
```

It is a **discovery assistant, not an authority.** Dates, eligibility and vacancies can change or be
reported wrongly. Every listing links to its sources and says how trustworthy they are; always
confirm against the official notification before you apply.

> **Read [What is and is not finished](#what-is-and-is-not-finished) before relying on this.** It
> lists what was verified, what was only tested with mocks, and what is not built.

---

## Quick start

Needs Node ≥ 22.5. **No API keys, database server or other services are required.**

```bash
npm install
cp .env.example .env.local      # optional; every value has a working default
npm run db:setup                # create the SQLite database and seed it
npm run dev                     # http://localhost:3000
```

Try it with the sample resumes in `tests/fixtures/` (`sample-resume.pdf`, `.docx`, `.txt`).

### Seed accounts

These exist only after `npm run db:seed`. **Change the passwords** (or set `SEED_*_PASSWORD`)
before exposing the app anywhere.

| Role | Email | Password |
|---|---|---|
| Candidate | `candidate@opportunity-analyzer.local` | `ChangeMe!Candidate2026` |
| Data / opportunity analyst | `analyst@opportunity-analyzer.local` | `ChangeMe!Analyst2026` |
| Verified recruiter | `recruiter@opportunity-analyzer.local` | `ChangeMe!Recruiter2026` |
| Platform admin | `ops@opportunity-analyzer.local` | `ChangeMe!SuperAdmin2026` |
| Super admin | `admin@opportunity-analyzer.local` | `ChangeMe!SuperAdmin2026` |

Administrators must enrol an authenticator app at **/mfa** (TOTP) before privileged actions work;
until then the server refuses them with `mfa_required`. Self-registration always creates a
candidate — a role can only be changed by a super admin, with explicit confirmation, and is audited.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build && npm start` | development / production server |
| `npm run db:setup` | migrate + seed (`db:migrate`, `db:seed` separately; `db:seed -- --reset` wipes first) |
| `npm run check` | typecheck + lint + every test |
| `npm test` | tests only (see [Testing](#testing)) |

---

## What it does

- **Resume → profile.** PDF, DOCX or TXT (10 MB). The original file is never modified. Personal
  info, education, skills (11 categories), experience, certifications and projects are read from
  the document; career level, job families, industries, government and exam categories, strongest /
  missing / transferable skills and career paths are *inferred*. Every inferred value carries a
  **confidence score and a source**, and the UI distinguishes "from your resume" from "inferred".
  Nothing is invented: an absent name stays blank with a warning, an unparseable date stays
  unknown, age is computed only from a stated date of birth.
- **Search.** Queries are generated from the profile (not hard-coded) and spread across job,
  internship, government, exam and official-portal intents. Providers: Tavily, Serper, Brave, Bing,
  SearXNG. With none configured it searches the platform's own catalogue and **labels the results
  as such**. The pipeline works from the titles and snippets those APIs return; it does **not**
  crawl the result pages (a `robots.txt`-respecting fetcher exists but is not wired in), so any
  field a snippet does not mention stays *Unknown* rather than being guessed.
- **Government examination intelligence.** Notification and application dates, fee and correction
  windows, admit card, exam, answer key, result, interview, final result, official links, and a
  **nine-stage timeline** that marks the user's current stage. Status is one of Applications Open ·
  Closing Soon · Deadline Today · Closed · Exam Upcoming · Admit Card Released · Exam Completed ·
  Result Released · Notification Expected · **Needs Verification**, and the status is *never
  guessed*: with no dates, or with conflicting ones, it is Needs Verification.
- **Deadlines** in India Standard Time, urgency bands (critical 0–2 days, high 3–7, medium 8–15),
  "Apply Now — Deadline in 2 Days" / "Application Closed" wording.
- **Matching.** Separate models: a weighted fit model for private roles (skill 30, qualification
  20, experience 15, role 15, location/industry/salary/growth 5 each, configurable per user and by
  an administrator) and an **eligibility-gated** model for government posts. Match bands: 🏆 Perfect
  · 🔥 Strong · 👍 Good · 📌 Possible · ⚠️ Skill Gap · ❌ Not Eligible. Each result explains itself
  ("Why this job?", strengths, gaps). Eligibility says *probably eligible* when it cannot be
  certain, and *not eligible* only on an explicit blocker.
- **Multi-source verification.** Sources' claims are compared. Disagreements are shown with each
  source's value (⚠️ Conflicting Information); the official value is named only when an official
  source exists. Duplicates across sources are merged ("Found on 4 sources").
- **Trust score** (0–100) with 🟢 Verified / 🟡 Needs Verification / 🔴 Suspicious, from official
  domains, pay-to-apply and other scam signals.
- **Everything else in the spec that is built:** dashboard with six summary cards, filters
  (type, experience, mode, location, salary, deadline window, match band), saved items, application
  tracker (8 statuses), skill-gap analysis, career roadmap, resume ↔ job optimiser (missing
  keywords, ATS score, suggested rewording), grounded AI chat, daily/weekly digest, deadline
  alerts, feedback loop that re-ranks results, analysis progress screen with honest per-step status,
  admin panels (users, opportunities, exams, data quality, audit log, configuration).

### How data is kept honest

These are enforced in code and pinned by tests, because each was once violated:

- **Re-discovery adds knowledge; it never erases it.** A search snippet can fill a blank field,
  contribute a source or raise a conflict; it cannot overwrite a value already held, and reading the
  platform's own catalogue back writes nothing.
- **Scores belong to the viewer.** The opportunity table is shared, so nothing personal is stored on
  it: fit, eligibility, rank and "Perfect Matches" are computed per viewer from their own profile,
  weights, locations and feedback.
- **Fallbacks are labelled.** No AI key → the local rule engine, and it says so. No search key → the
  local catalogue, and it says so. No email provider → nothing is queued and nothing is marked
  "sent". No antivirus → the scan is reported `unavailable`, never `clean`.
- **Every editable setting does something.** Settings are declared once in `src/lib/config.ts`,
  each is read by the code that uses it, and each has a test that saves a value and checks the
  behaviour changed. (The panel used to show settings that nothing read.)

---

## Configuration

All variables are optional. See `.env.example` for the full annotated list.

| Group | Variables |
|---|---|
| Security | `SESSION_SECRET` (signs cookies — **required in production**), `ENCRYPTION_KEY` (encrypts stored resumes and MFA secrets; `openssl rand -hex 32`), `TRUST_PROXY_HOPS`, `FRAME_ANCESTORS` (default `none`; read at **build** time), `COOKIE_SAMESITE` (default `lax`) |
| Database | `DATABASE_URL` (`postgres://…` for PostgreSQL; unset = SQLite), `SQLITE_DIR`, `PG_SSL`, `PG_POOL_MAX` |
| AI | `AI_PROVIDER` (`auto`/`openai`/`anthropic`/`gemini`/`none`), `OPENAI_API_KEY` (+ `OPENAI_BASE_URL` for Azure/Groq/OpenRouter/local), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, models, `AI_MAX_DAILY_CALLS` |
| Search | `SEARCH_PROVIDER`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `BRAVE_API_KEY`, `BING_API_KEY`, `SEARXNG_URL`, `SEARCH_MAX_PROVIDERS`, `SEARCH_QUERIES_PER_ANALYSIS` |
| Uploads | `UPLOAD_DIR`, `MAX_UPLOAD_BYTES`, `CLAMD_HOST`/`CLAMD_PORT` (ClamAV) |
| Email & alerts | `EMAIL_PROVIDER` (`smtp`/`console`), `SMTP_HOST/PORT/SECURE/USER/PASS`, `EMAIL_FROM`, `APP_BASE_URL`, `CRON_SECRET` |

**Admin-adjustable settings** (Admin → Configuration) — AI provider and order, daily AI call cap,
search provider order, providers per query, queries per analysis, default match weights, login
attempt limit, MFA enforcement for administrators, re-verification interval, digest hour — plus
four feature flags (demonstration listings, resume optimiser, browser notifications, maintenance
mode). Precedence: **an environment variable, when set, wins and locks the setting in the panel**;
otherwise the saved value applies; otherwise the default. Values are validated on save, unknown
keys are refused, and every change is audited with its previous value.

### Scheduled work

Deadline alerts for a signed-in user are generated whenever they open the app, so alerts work with
no infrastructure. To also create alerts/digests for people who are not online and to deliver
email, call the sweep from a scheduler (every ~30 minutes):

```bash
curl -X POST "$APP_BASE_URL/api/notifications/sweep" -H "x-cron-secret: $CRON_SECRET"
```

With `CRON_SECRET` unset that path is closed; an MFA-verified super admin can still trigger it.

---

## Security model

| Control | Implementation |
|---|---|
| Authentication | Email + password (scrypt), signed `HttpOnly` session cookie, revoked on role change / suspension / logout |
| Sign-in protection | Per-IP limit **and** per-account lockout after 10 consecutive failures (15 min, durable in the database). One refusal message for wrong password, unknown email and locked account, so responses never reveal which emails exist |
| Second factor | TOTP (RFC 6238) for admin and super admin, verified **per session**; the secret is encrypted with `ENCRYPTION_KEY` when one is set (stored as-is otherwise) |
| Authorisation | Backend-enforced chain: authenticated → identity → role → permission → resource ownership. 56 permissions across 6 roles; a candidate can never read another candidate's data |
| Role escalation | No self-role-change; granting a privileged role needs a super admin **and** explicit confirmation; higher-ranked accounts cannot be suspended |
| CSRF | Double-submit token (`x-csrf-token`) on every state-changing request, `SameSite=Lax` cookies |
| Input validation | Zod schemas on request bodies; parameterised SQL throughout |
| Uploads | Size cap; content sniffing (extension and declared type are not trusted); a zip is only a DOCX if it contains a Word document; typed 422 errors instead of crashes; optional ClamAV scan; stored outside the web root and served only through an owner-checked route |
| Encryption at rest | AES-256-GCM (random IV per file, tamper-evident) when `ENCRYPTION_KEY` is set. Verified end to end: ciphertext on disk, byte-identical download for the owner, 403 for another user, 401 when anonymous |
| Privacy | Resumes are never public and never shared between users. "Delete my resume" removes the file **and** everything derived from it. "Delete my account" is one database transaction (all-or-nothing) that erases every owned row, removes the files afterwards and revokes all sessions; a privileged user's audit trail is **anonymised, not erased**, and the last active super admin cannot delete themselves |
| Crawling | The guarded fetcher honours `robots.txt` (fails closed, correct group/`$`/prefix semantics) and never contacts private, loopback or metadata addresses; nothing bypasses CAPTCHAs, paywalls or anti-bot measures. (The pipeline itself currently uses search-API snippets only — see Search.) |
| Audit | Append-only log with actor, previous and new value, reason and IP for every privileged action |
| Information disclosure | Anonymous `/api/health` returns liveness only; diagnostics need an MFA-verified operator |

---

## Architecture

```
src/
  app/                 21 pages and 39 API routes (Next.js App Router)
  components/          shared UI (badges, score bars, timelines) and the app shell
  lib/
    analysis/          resume parser, candidate profiler, skill/degree taxonomy
    opportunity/       matcher, eligibility, ranker, trust, dedupe, verification,
                       deadlines, per-user scoring, query generation, explanations
    pipeline/          the research pipeline (resume → … → ranking) and its persistence
    search/            provider adapters, robots.txt, local catalogue
    ai/                provider abstraction (OpenAI-compatible, Anthropic, Gemini) + fallbacks
    auth/              sessions, RBAC, TOTP, CSRF, password policy
    db/                portable SQL schema, SQLite and PostgreSQL drivers, migrations
    parsing/           PDF/DOCX/TXT extraction, sniffing, encryption, malware scan
    config.ts          the settings registry (single source of truth)
    notifications.ts   deadline alerts, digests, email delivery
scripts/               migrate, seed
tests/                 17 files, 307 tests (+ sample resumes in tests/fixtures)
```

The schema is portable SQL (text ids and timestamps, JSON in text columns) so the same DDL runs on
SQLite and PostgreSQL. 34 tables.

---

## Testing

```bash
npm run check          # typecheck + lint + all tests
```

| Suite | Covers |
|---|---|
| `resume-parser` | parsing across layouts (dates above/below/inline headers, company names containing "to", sentences that are not jobs), degree recognition |
| `matching`, `personalisation` | trust, eligibility (qualification *alternatives*, named degrees, unknowns), scoring, dedupe, conflicts; per-viewer ranking, weights, locations, feedback |
| `deadline` | urgency bands, IST, status derivation that never guesses |
| `persistence` | the pipeline's write rules (no erasing, no writes when reading our own catalogue, conflicts surfaced) — mutation-checked |
| `extraction` | real PDF/DOCX/TXT fixtures, PDF line reconstruction, hostile files, encryption round-trip and tamper detection |
| `degradation` | AI and search failures, rate limits, robots.txt and SSRF guards, honest verification |
| `config` | registry, validation, precedence, and that each saved setting changes behaviour |
| `notifications`, `browser-notifications` | idempotent alerts, deadline extensions, email honesty, desktop notifications |
| `security`, `login-route`, `malware-scan` | permissions, MFA/TOTP, password policy, client-IP derivation and failure counting; the sign-in route's attempt limit and durable account lockout; the ClamAV protocol against a fake daemon |
| `privacy`, `digest` | encryption on disk, owner-only reads, deletion of derived data, infected uploads, account deletion rules; digest timing |
| `security-headers` | strict framing/cookie defaults, and that the opt-outs fail safe |
| `ui-integration` | **every page rendered in jsdom against a running server with a real session**, plus live checks of admin settings, maintenance mode, lockout, and the analysis screen |

`ui-integration` needs a running server on seeded data and is skipped when none is reachable:

```bash
npm run db:seed -- --reset
npm run dev            # or: npm run build && npm start
npm test
```

It signs in a few times per run, so against a server with the default 10-per-15-minutes login limit
run it a handful of times at most, or set `RATE_LIMIT_LOGIN`.

---

## Deploying

- **One long-running Node process.** Background searches, the in-memory rate limiter and the
  settings snapshot live in the process, so this is fine for one instance. Behind a load balancer
  each instance enforces its own rate limits (the account lockout is in the database and is shared),
  and a background search dies with the process that started it (its job is then reported as
  interrupted). It is **not suitable for serverless**.
- Set `SESSION_SECRET`, `ENCRYPTION_KEY` (keep it — losing it makes stored resumes unreadable) and
  `TRUST_PROXY_HOPS` (the number of reverse proxies in front; otherwise client IPs can be forged),
  and change the seed passwords or don't seed accounts.
- Put `UPLOAD_DIR` and (for SQLite) `SQLITE_DIR` on persistent storage, and back them up.
- Run a scheduler for `/api/notifications/sweep`.
- **Framing and cookies.** By default the app cannot be framed (`X-Frame-Options: DENY` + CSP
  `frame-ancestors 'none'`) and its cookies are `SameSite=Lax`. To run it *inside* another site's
  frame (a preview or portal) build with `FRAME_ANCESTORS=<origin>` (or `*`) and start with
  `COOKIE_SAMESITE=none`, which needs HTTPS and marks cookies `Secure; Partitioned`; without that,
  sign-in silently fails in a cross-site frame. CSRF stays defended by the `x-csrf-token` header.
- `/api/health` (as an operator) lists what is misconfigured.

---

## What is and is not finished

### Verified by running it

The full upload → profile → search → match → detail → track flow over HTTP, with every page
rendered in jsdom against the live API; PDF, DOCX and TXT extraction with real files; RBAC, CSRF,
MFA and lockout against a live server; encryption at rest end to end; account and resume deletion;
the production build (compiled, linted, type-checked, and the whole suite passing against
`next start`). 307 tests. Writing them found and fixed, among others: PDF resumes losing all line
structure, DOCX resumes losing institutions and years, a search that overwrote catalogue data, scores
shared between users, a configuration panel whose settings nothing read, account deletion that could
never have worked, and a login lockout that never triggered.

### Implemented but **not** exercised against the real thing

- **AI providers** (OpenAI-compatible, Anthropic, Gemini) and **search providers** (Tavily, Serper,
  Brave, Bing, SearXNG): the adapters are written and tested against mocked HTTP, but this
  environment had no keys or outbound access, so they have **never called a live service**. Expect
  to adjust payload details on first real use. Without them the app runs on the local rule engine
  and the local catalogue, and says so everywhere.
- **PostgreSQL**: the driver exists and the schema is portable, but no PostgreSQL server was
  available, so it has never run. SQLite is the verified path.
- **SMTP email**: sends through nodemailer; tested with injected transports only, not a real mail
  server.
- **A real browser.** Pages are verified by rendering them in jsdom against the live API, which
  catches contract and crash bugs but says nothing about layout, responsiveness, colour contrast or
  keyboard use. No visual or accessibility audit has been done.

### Not built

- Google OAuth sign-in, email verification, password reset.
- Listing and revoking other signed-in sessions.
- The recruiter portal (posting listings, recruiter verification, sharing applicants). The role and
  its permissions exist; there are no endpoints or screens for it. The moderator role is defined
  but has no dedicated features.
- Background web push (desktop notifications are shown only while the app is open in a tab).
- OCR: a scanned, image-only PDF is refused with an explanation.
- Non-English resumes; reliable reading order for multi-column PDF layouts.

### Data

The seeded catalogue (10 examinations, 10 listings) was compiled from public web pages on
**2026-09-29**. Six listings are clearly labelled demonstration data, and one is a deliberate scam
example to show suspicious-listing detection. Re-verify every date against the official notification.
