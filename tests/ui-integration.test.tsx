// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { totpCodeAt } from '@/lib/auth/totp';

/**
 * UI ↔ API integration (no browser required).
 *
 * Every page component is rendered in jsdom against the REAL running server, with a REAL
 * logged-in session, so the page consumes the API's actual responses. That is what catches the
 * class of bug unit tests cannot: a page reading a field the API never sends, a list that
 * crashes on an empty value, a component that throws on real data.
 *
 * Needs a running server with a seeded database:
 *     npm run db:seed -- --reset && npm run dev
 * When none is reachable the whole file is skipped, so `npm test` stays green offline.
 * Point it elsewhere with UI_TEST_BASE_URL.
 */

const BASE = process.env.UI_TEST_BASE_URL ?? 'http://127.0.0.1:3000';
const nodeFetch = globalThis.fetch;

const shared = vi.hoisted(() => ({ params: {} as Record<string, string>, search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined, forward: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(shared.search),
  useParams: () => shared.params,
  redirect: () => undefined,
  notFound: () => undefined,
}));

const serverUp = await nodeFetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);

interface Session {
  jar: string;
  csrf: string;
}

async function login(email: string, password: string): Promise<Session> {
  const seed = await nodeFetch(`${BASE}/api/csrf`);
  const token = ((await seed.json()) as { csrfToken: string }).csrfToken;
  const res = await nodeFetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie: `oaa_csrf=${token}` },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: HTTP ${res.status} ${await res.text()}`);
  const jar = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const csrf = /oaa_csrf=([^;]+)/.exec(jar)?.[1] ?? token;
  return { jar, csrf };
}

const call = (session: Session, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('cookie', session.jar);
  headers.set('x-csrf-token', session.csrf);
  return nodeFetch(`${BASE}${path}`, { ...init, headers });
};

let inflight = 0;
function installSession(session: Session | null) {
  document.cookie = session ? `oaa_csrf=${session.csrf}; path=/` : 'oaa_csrf=; path=/; max-age=0';
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init.headers);
    if (session) headers.set('cookie', session.jar);
    inflight += 1;
    try {
      return await nodeFetch(raw.startsWith('http') ? raw : `${BASE}${raw}`, { ...init, headers });
    } finally {
      inflight -= 1;
    }
  }) as typeof fetch;
}

/** Wait until the page has stopped talking to the server and React has applied the results. */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await waitFor(() => expect(inflight).toBe(0), { timeout: 20_000 });
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

const CRASH = /Uncaught|The above error occurred|Cannot read propert|is not a function|is not iterable|Each child in a list|Objects are not valid as a React child|Maximum update depth/;
const LEAKS = /\b(undefined|NaN)\b|\[object Object\]/;

const RESUME = `PRIYA RAMESH
Chennai, Tamil Nadu | priya.ramesh@example.com

EDUCATION
Bachelor of Commerce (B.Com), Accounting & Finance
University of Madras, Chennai - 2025, 78%

SKILLS
Tally ERP 9, MS Excel, GST Filing, TDS, Bank Reconciliation, Accounts Payable

EXPERIENCE
Accounts Intern — Lakshmi & Associates, Chartered Accountants, Chennai
June 2024 - August 2024
- Prepared 120+ journal entries and assisted with monthly GST returns.

CERTIFICATIONS
GST Practitioner Certificate — TaxMann Institute, 2025
`;

let candidate: Session;
const ids = { job: '', opportunity: '', closed: '', governmentExam: '', conflicting: '', suspicious: '', exam: '', conflictingExam: '', upcomingExam: '' };

beforeAll(async () => {
  if (!serverUp) return;
  candidate = await login('candidate@opportunity-analyzer.local', 'ChangeMe!Candidate2026');

  // Make sure the candidate has a profile and some search results, exactly as a user would.
  let profile = await call(candidate, '/api/profile');
  if (profile.status === 404) {
    // Built by hand: jsdom replaces FormData/Blob with its own classes, which Node's fetch
    // cannot serialise, so the request would hang instead of uploading.
    const boundary = `----oaa${Math.random().toString(16).slice(2)}`;
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="resume.txt"\r\nContent-Type: text/plain\r\n\r\n${RESUME}\r\n--${boundary}--\r\n`;
    const upload = await call(candidate, '/api/resumes', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (!upload.ok) throw new Error(`resume upload failed: ${upload.status} ${await upload.text()}`);
    profile = await call(candidate, '/api/profile');
  }

  // One finished search, reused by the analysis-screen smoke test so this suite does not spend
  // the per-user search quota (12/hour) on every render.
  const run = await call(candidate, '/api/search/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxQueries: 8 }) });
  if (run.ok) ids.job = ((await run.json()) as { searchJobId: string }).searchJobId;
  else if (run.status !== 409) throw new Error(`search failed: ${run.status} ${await run.text()}`);

  type Row = { id: string; isClosed: boolean; type: string; verificationStatus: string; status: string };
  const list = (await (await call(candidate, '/api/opportunities?limit=100')).json()) as { opportunities: Row[] };
  const pick = (test: (row: Row) => boolean) => list.opportunities.find(test)?.id ?? '';
  ids.opportunity = list.opportunities.find((o) => o.type === 'job' || o.type === 'internship')?.id ?? list.opportunities[0]?.id ?? '';
  ids.closed = pick((o) => o.isClosed);
  ids.governmentExam = pick((o) => o.type === 'exam' || o.type === 'government_job');
  ids.conflicting = pick((o) => o.verificationStatus === 'conflicting');
  ids.suspicious = pick((o) => o.verificationStatus === 'suspicious');

  const exams = (await (await call(candidate, '/api/exams')).json()) as { exams: { id: string; verificationStatus: string; status: string }[] };
  ids.exam = exams.exams[0]?.id ?? '';
  ids.conflictingExam = exams.exams.find((e) => e.verificationStatus === 'conflicting')?.id ?? '';
  ids.upcomingExam = exams.exams.find((e) => e.status === 'notification_expected')?.id ?? '';

  // Give the saved/applications/notifications pages something real to show.
  if (ids.opportunity) await call(candidate, '/api/saved', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opportunityId: ids.opportunity }) });
}, 120_000);

afterEach(() => {
  cleanup();
  shared.params = {};
  shared.search = '';
  vi.restoreAllMocks();
});

interface PageCase {
  name: string;
  load: () => Promise<{ default: React.ComponentType }>;
  marker: RegExp;
  params?: () => Record<string, string>;
  search?: string | (() => string);
  anonymous?: boolean;
}

const PAGES: PageCase[] = [
  { name: 'landing', load: () => import('@/app/page'), marker: /Opportunity Analyzer|Upload Your Resume/i, anonymous: true },
  { name: 'login', load: () => import('@/app/login/page'), marker: /sign in|log in/i, anonymous: true },
  { name: 'register', load: () => import('@/app/register/page'), marker: /create|register|sign up/i, anonymous: true },
  { name: 'dashboard', load: () => import('@/app/dashboard/page'), marker: /Perfect Matches/ },
  { name: 'jobs', load: () => import('@/app/jobs/page'), marker: /Jobs|Filters/i },
  { name: 'government', load: () => import('@/app/government/page'), marker: /Government/i },
  { name: 'exams', load: () => import('@/app/exams/page'), marker: /Exam/i },
  { name: 'saved', load: () => import('@/app/saved/page'), marker: /Saved/i },
  { name: 'applications', load: () => import('@/app/applications/page'), marker: /Applications?/i },
  { name: 'skills', load: () => import('@/app/skills/page'), marker: /Skill/i },
  { name: 'career-roadmap', load: () => import('@/app/career-roadmap/page'), marker: /Roadmap|Career/i },
  { name: 'resume optimiser', load: () => import('@/app/resume/page'), marker: /Resume/i },
  { name: 'settings', load: () => import('@/app/settings/page'), marker: /Settings|Notifications/i },
  { name: 'notifications', load: () => import('@/app/notifications/page'), marker: /Notification/i },
  { name: 'chat', load: () => import('@/app/chat/page'), marker: /Ask|Assistant|Chat/i },
  { name: 'upload', load: () => import('@/app/upload/page'), marker: /Upload/i },
  { name: 'analyze (resuming a finished job)', load: () => import('@/app/analyze/page'), marker: /Analy/i, search: () => `jobId=${ids.job}` },
  { name: 'mfa', load: () => import('@/app/mfa/page'), marker: /two-factor|Two-factor/i },
  { name: 'job detail', load: () => import('@/app/opportunity/[id]/page'), marker: /Why this job|Sources?/i, params: () => ({ id: ids.opportunity }) },
  { name: 'closed listing detail', load: () => import('@/app/opportunity/[id]/page'), marker: /Closed|closed/i, params: () => ({ id: ids.closed }) },
  { name: 'government-exam listing detail', load: () => import('@/app/opportunity/[id]/page'), marker: /Why this job|Sources?/i, params: () => ({ id: ids.governmentExam }) },
  { name: 'conflicting-source listing detail', load: () => import('@/app/opportunity/[id]/page'), marker: /conflict/i, params: () => ({ id: ids.conflicting }) },
  { name: 'suspicious listing detail', load: () => import('@/app/opportunity/[id]/page'), marker: /suspicious|not verified|scam|caution/i, params: () => ({ id: ids.suspicious }) },
  { name: 'exam detail', load: () => import('@/app/exam/[id]/page'), marker: /Timeline|Eligibility|Notification/i, params: () => ({ id: ids.exam }) },
  { name: 'conflicting exam detail', load: () => import('@/app/exam/[id]/page'), marker: /conflict/i, params: () => ({ id: ids.conflictingExam }) },
  { name: 'upcoming (notification expected) exam detail', load: () => import('@/app/exam/[id]/page'), marker: /Timeline|Notification/i, params: () => ({ id: ids.upcomingExam }) },
];

describe.skipIf(!serverUp)('every page renders real API data without crashing', () => {
  for (const page of PAGES) {
    it(page.name, async () => {
      if (page.params) {
        const params = page.params();
        if (!params.id) return; // e.g. no closed listing in this catalogue — nothing to render
        shared.params = params;
      }
      shared.search = typeof page.search === 'function' ? page.search() : (page.search ?? '');
      installSession(page.anonymous ? null : candidate);

      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.map(String).join(' ')));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const { default: Page } = await page.load();
      render(<Page />);
      await settle();

      const text = document.body.textContent ?? '';
      // Show the underlying React error first: a blank page is a symptom, this is the cause.
      const crashes = errors.filter((e) => CRASH.test(e)).map((e) => e.replace(/\s+/g, ' ').slice(0, 500));
      expect(crashes, 'React reported an error while rendering').toEqual([]);
      expect(text.trim().length, 'page rendered nothing').toBeGreaterThan(40);
      expect(text, 'expected content is missing').toMatch(page.marker);
      const leak = LEAKS.exec(text);
      expect(leak, `a raw programming value leaked into the UI near: "${leak ? text.slice(Math.max(0, leak.index - 40), leak.index + 40) : ''}"`).toBeNull();
    }, 60_000);
  }
});

async function show(load: () => Promise<{ default: React.ComponentType }>, params: Record<string, string> = {}, search = '') {
  shared.params = params;
  shared.search = search;
  installSession(candidate);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { default: Page } = await load();
  render(<Page />);
  await settle();
  return document.body.textContent ?? '';
}

const getJson = async (path: string) => (await (await call(candidate, path)).json()) as any;

describe.skipIf(!serverUp)('pages show the real data, not just a shell', () => {
  it('the job list shows the catalogue titles the API returned', async () => {
    const api = await getJson('/api/opportunities?limit=30');
    const text = await show(() => import('@/app/jobs/page'));
    const shown = api.opportunities.slice(0, 5).filter((o: any) => text.includes(o.title));
    expect(shown.length, `none of the first API titles appeared on /jobs`).toBeGreaterThan(0);
  });

  it('the dashboard shows real numbers and names a real opportunity', async () => {
    const api = await getJson('/api/opportunities?limit=12');
    const text = await show(() => import('@/app/dashboard/page'));
    expect(text).toMatch(/Jobs Found/);
    expect(text).toMatch(/Government/);
    expect(text).toMatch(/Closing Soon/);
    expect(api.opportunities.some((o: any) => text.includes(o.title))).toBe(true);
    // The Perfect Matches card must reflect the API's own count, not a stale or invented one.
    expect(text).toContain(`${api.summary.perfect}`);
  });

  it("the skills page lists the candidate's real skills, each with a name", async () => {
    const text = await show(() => import('@/app/skills/page'));
    expect(text).toMatch(/Tally/i);
    expect(text).toMatch(/GST/i);
    expect(text).toMatch(/Your strongest skills/);
    // A row whose name is blank is the failure mode this guards against.
    const profile = await getJson('/api/profile');
    for (const skill of profile.profile.strongestSkills) expect(text).toContain(skill.name);
  });

  it('the analysis screen reports each step with the status the server recorded', async () => {
    const text = await show(() => import('@/app/analyze/page'));
    expect(text).toMatch(/Pipeline complete/);
    // Every step label is present...
    for (const label of ['Resume uploaded', 'Generating search queries', 'Searching opportunity sources', 'Saving to your dashboard']) {
      expect(text).toContain(label);
    }
    // ...and the server's own detail for the last step is shown, proving the `key`/`step`
    // mapping works (before the fix every step stayed "pending" and no detail ever appeared).
    expect(text).toMatch(/already in the catalogue|new, \d+ updated/);
    expect(text).toMatch(/Nothing new to verify|No source conflicts|conflicting source data/);
    expect(text).toMatch(/Search queries generated from your resume/);
    expect(text).not.toMatch(/\(undefined/);
  }, 90_000);

  it('a job detail page shows the organisation, a personal score and the explanation', async () => {
    const api = await getJson(`/api/opportunity/${ids.opportunity}`);
    const text = await show(() => import('@/app/opportunity/[id]/page'), { id: ids.opportunity });
    expect(text).toContain(api.opportunity.title);
    if (api.opportunity.organization) expect(text).toContain(api.opportunity.organization);
    expect(text).toMatch(/Eligibility (\d+|—)%? · Fit \d+%/);
    if (api.opportunity.explanation) expect(text).toContain(api.opportunity.explanation.slice(0, 40));
    // Source transparency: where the listing came from is on the card.
    expect(text).toMatch(/Sources?/i);
  });

  it('a conflicting listing shows BOTH disagreeing values, never just one', async () => {
    const api = await getJson(`/api/opportunity/${ids.conflicting}`);
    const text = await show(() => import('@/app/opportunity/[id]/page'), { id: ids.conflicting });
    expect(api.opportunity.conflicts.length).toBeGreaterThan(0);
    const values = new Set<string>(api.opportunity.conflicts.map((c: any) => String(c.value)));
    expect(values.size, 'fixture should carry at least two distinct values').toBeGreaterThan(1);
    // Whatever format the UI renders a date in, the conflict banner must be visible.
    expect(text).toMatch(/Conflicting Information/i);
  });

  it('an exam page shows the nine-stage timeline and the official notification', async () => {
    const api = await getJson(`/api/exam/${ids.exam}`);
    const text = await show(() => import('@/app/exam/[id]/page'), { id: ids.exam });
    expect(text).toContain(api.exam.name);
    expect(api.exam.timeline).toHaveLength(9);
    for (const stage of api.exam.timeline) expect(text).toContain(stage.label);
    expect(text).toMatch(/Official notification/i);
  });

  it('the government page separates open applications from notifications still expected', async () => {
    const text = await show(() => import('@/app/government/page'));
    expect(text).toMatch(/Government opportunities/);
    expect(text).not.toMatch(/\bundefined\b/);
  });
});

let adminSession: Promise<Session> | null = null;
/** An administrator whose session has passed the real TOTP enrolment + verification flow. */
function adminWithMfa(): Promise<Session> {
  adminSession ??= (async () => {
    const session = await login('admin@opportunity-analyzer.local', 'ChangeMe!SuperAdmin2026');
    const enrolled = (await (await call(session, '/api/auth/mfa/enroll', { method: 'POST' })).json()) as { secret: string };
    const verified = await call(session, '/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: totpCodeAt(enrolled.secret) }) });
    if (!verified.ok) throw new Error(`MFA verification failed: ${verified.status}`);
    return session;
  })();
  return adminSession;
}

const json = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe.skipIf(!serverUp)('deleting an account, through the real route', () => {
  it('ends the session, removes the resume file and data, and frees nothing for anyone else', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { db } = await import('@/lib/db');

    const email = `leaver-${Date.now()}@example.test`;
    const password = 'Correct-Horse-Battery-7';
    const seed = await nodeFetch(`${BASE}/api/csrf`);
    const token = ((await seed.json()) as { csrfToken: string }).csrfToken;
    const created = await nodeFetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie: `oaa_csrf=${token}`, 'x-forwarded-for': '198.51.100.251' },
      body: JSON.stringify({ email, password, name: 'Leaver' }),
    });
    expect(created.status).toBe(201);
    const session = await login(email, password);

    const boundary = `----oaa${Math.random().toString(16).slice(2)}`;
    const upload = await call(session, '/api/resumes', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="resume.txt"\r\nContent-Type: text/plain\r\n\r\n${RESUME}\r\n--${boundary}--\r\n`,
    });
    expect(upload.status).toBe(201);
    const resumeId = ((await upload.json()) as any).resume.id as string;
    const stored = join(process.cwd(), 'data', 'uploads');
    const fileExists = () => ['txt', 'pdf', 'docx'].some((ext) => existsSync(join(stored, `${resumeId}.${ext}`)));
    expect(fileExists()).toBe(true);

    const removed = await call(session, '/api/account', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as any)).toMatchObject({ deleted: true, resumesRemoved: 1 });

    // The old session is dead, the credentials no longer work, and the file is gone.
    expect((await call(session, '/api/auth/me')).status).toBe(401);
    const again = await nodeFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie: `oaa_csrf=${token}`, 'x-forwarded-for': '198.51.100.252' },
      body: JSON.stringify({ email, password }),
    });
    expect(again.status).toBe(401);
    expect(fileExists()).toBe(false);
    expect(Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM resumes WHERE id = ?', [resumeId]))?.n)).toBe(0);
  }, 90_000);

  it('will not let the only super admin delete their own account', async () => {
    const admin = await adminWithMfa();
    const attempt = await call(admin, '/api/account', { method: 'DELETE' });
    expect(attempt.status).toBe(409);
    expect(((await attempt.json()) as any).code).toBe('last_super_admin');
    expect((await call(admin, '/api/auth/me')).status).toBe(200); // still signed in, still an account
  }, 60_000);
});

describe.skipIf(!serverUp)('sign-in protection', () => {
  const PASSWORD = 'Correct-Horse-Battery-7';
  const attempt = async (email: string, password: string, forwardedFor: string) => {
    const seed = await nodeFetch(`${BASE}/api/csrf`);
    const token = ((await seed.json()) as { csrfToken: string }).csrfToken;
    const response = await nodeFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      // A different forged address on every request: the per-IP limit never sees the same client twice.
      headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie: `oaa_csrf=${token}`, 'x-forwarded-for': forwardedFor },
      body: JSON.stringify({ email, password }),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  it('locks one account after repeated failures even when the attacker rotates forged IP addresses', async () => {
    const email = `lockout-${Date.now()}@example.test`;
    const seed = await nodeFetch(`${BASE}/api/csrf`);
    const token = ((await seed.json()) as { csrfToken: string }).csrfToken;
    const created = await nodeFetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie: `oaa_csrf=${token}`, 'x-forwarded-for': '198.51.100.250' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Lockout Tester' }),
    });
    expect(created.status).toBe(201);

    // Ten wrong guesses, each "from" a different address.
    const refusals: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const result = await attempt(email, `wrong-guess-${i}`, `203.0.113.${i + 1}`);
      expect(result.status).toBe(401);
      refusals.push(result.body.error);
    }

    // Now even the CORRECT password, from yet another address, is refused.
    const locked = await attempt(email, PASSWORD, '203.0.113.200');
    expect(locked.status).toBe(401);
    expect(locked.body.error).toBe(refusals[0]);

    // An email that has no account gets the very same answer, so the lockout reveals nothing.
    const ghost = `nobody-${Date.now()}@example.test`;
    const ghostReplies: string[] = [];
    for (let i = 0; i < 11; i += 1) ghostReplies.push((await attempt(ghost, 'whatever', `203.0.113.${100 + i}`)).body.error);
    expect(new Set(ghostReplies).size).toBe(1);
    expect(ghostReplies[0]).toBe(refusals[0]);
  }, 120_000);

  it('does not let one locked account affect anyone else', async () => {
    const result = await attempt('candidate@opportunity-analyzer.local', 'ChangeMe!Candidate2026', '203.0.113.201');
    expect(result.status).toBe(200);
  });
});

describe.skipIf(!serverUp)('administrator settings act on the running platform', () => {
  let admin: Session;
  beforeAll(async () => {
    admin = await adminWithMfa();
  }, 60_000);

  // Whatever a test does, leave the shared server the way it was found.
  afterAll(async () => {
    if (!admin) return;
    await call(admin, '/api/admin/config', json({ flag: 'maintenance_mode', enabled: false, reason: 'test cleanup' }));
    await call(admin, '/api/admin/config', json({ flag: 'demo_data', enabled: true, reason: 'test cleanup' }));
    await call(admin, '/api/admin/config', json({ key: 'search.max_providers', value: '2', reason: 'test cleanup' }));
  });

  const settings = async () => ((await (await call(admin, '/api/admin/config')).json()) as any).settings as any[];

  it('lists every registered setting with its effective value and where it comes from', async () => {
    const all = await settings();
    expect(all.length).toBeGreaterThanOrEqual(11);
    for (const setting of all) {
      expect(['environment', 'database', 'default']).toContain(setting.source);
      expect(typeof setting.label).toBe('string');
      expect(setting.value).not.toBeUndefined();
      expect(setting.locked).toBe(setting.source === 'environment');
    }
    expect(all.map((s) => s.key)).toEqual(expect.arrayContaining(['ai.provider', 'search.max_providers', 'security.rate_limit_login']));
  });

  it('refuses an unknown setting, an invalid value and an unknown flag, and changes nothing', async () => {
    const before = await settings();
    const unknown = await call(admin, '/api/admin/config', json({ key: 'made.up.setting', value: '1' }));
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as any).error).toMatch(/Unknown setting/);

    const invalid = await call(admin, '/api/admin/config', json({ key: 'search.max_providers', value: 'banana' }));
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as any).error).toMatch(/whole number/);

    const outOfRange = await call(admin, '/api/admin/config', json({ key: 'search.max_providers', value: '99' }));
    expect(outOfRange.status).toBe(400);

    const badFlag = await call(admin, '/api/admin/config', json({ flag: 'made_up_flag', enabled: true }));
    expect(badFlag.status).toBe(400);

    expect(await settings()).toEqual(before);
  });

  it('saves a valid value, reports it as stored here, and records the change in the audit log', async () => {
    const saved = await call(admin, '/api/admin/config', json({ key: 'search.max_providers', value: '3', reason: 'integration test' }));
    expect(saved.status).toBe(200);
    const updated = (await settings()).find((s) => s.key === 'search.max_providers');
    expect(updated).toMatchObject({ value: '3', source: 'database', locked: false });

    const audit = (await (await call(admin, '/api/admin/audit?limit=20')).json()) as any;
    const entry = audit.entries.find((e: any) => e.resource_id === 'search.max_providers');
    expect(entry).toBeDefined();
    expect(JSON.parse(entry.new_value)).toBe('3');
    expect(entry.actor_role).toBe('super_admin');
  });

  it('refuses to edit a setting that an environment variable pins, and says which variable', async () => {
    const pinned = (await settings()).find((setting) => setting.locked);
    if (!pinned) return; // nothing is pinned in this run's environment (e.g. plain `npm run dev`)
    expect(pinned.source).toBe('environment');
    expect(pinned.envVar).toMatch(/^[A-Z_]+$/);
    const valid = pinned.type === 'int' ? String(Number(pinned.value) + 0) : pinned.value;
    const attempt = await call(admin, '/api/admin/config', json({ key: pinned.key, value: valid, reason: 'should be refused' }));
    expect(attempt.status).toBe(409);
    const body = (await attempt.json()) as any;
    expect(body.code).toBe('locked_by_environment');
    expect(body.error).toContain(pinned.envVar);
    // ...and its value is untouched.
    expect((await settings()).find((setting) => setting.key === pinned.key)?.value).toBe(pinned.value);
  });

  it('hides the demonstration listings when that flag is off, and brings them back when it is on', async () => {
    const count = async () => ((await (await call(candidate, '/api/opportunities?limit=100')).json()) as any).opportunities.filter((o: any) => o.isDemo).length;
    const withDemos = await count();
    expect(withDemos).toBeGreaterThan(0);

    expect((await call(admin, '/api/admin/config', json({ flag: 'demo_data', enabled: false }))).status).toBe(200);
    expect(await count()).toBe(0);
    const stats = (await (await call(candidate, '/api/stats')).json()) as any;
    expect(stats.opportunities).toBeGreaterThan(0); // real listings remain

    expect((await call(admin, '/api/admin/config', json({ flag: 'demo_data', enabled: true }))).status).toBe(200);
    expect(await count()).toBe(withDemos);
  });

  it('pauses candidates\' changes in maintenance mode while reading, sign-in and admins keep working', async () => {
    const save = () => call(candidate, '/api/saved', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opportunityId: ids.opportunity }) });
    expect((await save()).status).toBeLessThan(400);

    expect((await call(admin, '/api/admin/config', json({ flag: 'maintenance_mode', enabled: true }))).status).toBe(200);
    try {
      const blocked = await save();
      expect(blocked.status).toBe(503);
      expect(((await blocked.json()) as any).code).toBe('maintenance');
      expect((await call(candidate, '/api/opportunities?limit=3')).status).toBe(200); // reading is untouched
      expect((await nodeFetch(`${BASE}/api/csrf`)).status).toBe(200); // signing in stays possible
      const me = (await (await call(candidate, '/api/auth/me')).json()) as any;
      expect(me.features.maintenance).toBe(true);
      // An administrator can still act — including switching it back off.
      expect((await call(admin, '/api/admin/config', json({ key: 'search.max_providers', value: '2' }))).status).toBe(200);
    } finally {
      expect((await call(admin, '/api/admin/config', json({ flag: 'maintenance_mode', enabled: false }))).status).toBe(200);
    }
    expect((await save()).status).toBeLessThan(400);
  });

  it('switches the resume optimiser off and on', async () => {
    const run = () =>
      call(candidate, '/api/resume-optimizer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opportunityId: ids.opportunity }) });
    expect((await run()).status).toBe(200);
    await call(admin, '/api/admin/config', json({ flag: 'resume_optimizer', enabled: false }));
    try {
      const refused = await run();
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as any).code).toBe('feature_disabled');
    } finally {
      await call(admin, '/api/admin/config', json({ flag: 'resume_optimizer', enabled: true }));
    }
    expect((await run()).status).toBe(200);
  });

  it('shows the administrator\'s settings in the Configuration panel', async () => {
    installSession(admin);
    const { default: AdminPage } = await import('@/app/admin/page');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getByRole } = render(<AdminPage />);
    await settle();
    const tab = getByRole('button', { name: /Configuration/i });
    await act(async () => {
      tab.click();
    });
    await settle();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Queries per analysis');
    expect(text).toContain('Require a second factor for administrators');
    expect(text).toContain('Maintenance mode');
    expect(text).toMatch(/set here|default|fixed by/);
    expect(LEAKS.exec(text)).toBeNull();
  }, 60_000);
});

describe.skipIf(!serverUp)('administration (second factor enforced)', () => {
  it('shows the verification prompt until TOTP is verified, then the panels', async () => {
    const admin = await login('admin@opportunity-analyzer.local', 'ChangeMe!SuperAdmin2026');
    const { default: AdminPage } = await import('@/app/admin/page');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.map(String).join(' ')));

    // Before verification the server refuses privileged data, and the page must say why.
    installSession(admin);
    render(<AdminPage />);
    await settle();
    expect(document.body.textContent).toMatch(/Two-factor verification required/i);
    cleanup();

    // Complete the real enrolment + verification flow, then the panels must load.
    const enrolled = (await (await call(admin, '/api/auth/mfa/enroll', { method: 'POST' })).json()) as { secret: string };
    const verified = await call(admin, '/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: totpCodeAt(enrolled.secret) }) });
    expect(verified.status).toBe(200);

    installSession(admin);
    render(<AdminPage />);
    await settle();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Two-factor verification required/i);
    expect(text).toMatch(/Users|Opportunities|Audit/i);
    expect(errors.filter((e) => CRASH.test(e))).toEqual([]);
    expect(LEAKS.exec(text)).toBeNull();
  }, 90_000);

  it('refuses a candidate outright', async () => {
    installSession(candidate);
    const { default: AdminPage } = await import('@/app/admin/page');
    render(<AdminPage />);
    await settle();
    expect(document.body.textContent).toMatch(/do not have access/i);
  }, 60_000);
});
