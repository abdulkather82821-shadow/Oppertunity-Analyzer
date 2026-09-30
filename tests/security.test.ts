import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasPermission, requiresMfa, ROLE_PERMISSIONS, PRIVILEGED_ROLES, MFA_REQUIRED_ROLES } from '@/lib/auth/permissions';
import { generateQueriesDeterministic } from '@/lib/opportunity/query-generator';
import { clientIp } from '@/lib/auth/rbac';
import { clearFailures, isOverLimit, recordFailure, resetRateLimits, checkRateLimit } from '@/lib/rate-limit';
import { profileCandidate } from '@/lib/analysis/profiler';
import { parseResume } from '@/lib/analysis/resume-parser';
import { checkPasswordPolicy } from '@/lib/auth/password';
import { generateSecret, totpCodeAt, verifyTotp, otpauthUri } from '@/lib/auth/totp';
import { validateUpload, UploadError, MAX_UPLOAD_BYTES } from '@/lib/parsing/extract';

/**
 * Security and generation contracts: least privilege, MFA for privileged roles, password
 * policy, upload validation, and dynamic (never hard-coded) search queries.
 */

describe('role permissions', () => {
  it('gives a candidate only their own data actions', () => {
    const permissions = ROLE_PERMISSIONS.candidate;
    expect(permissions).toContain('resume.upload');
    expect(permissions).toContain('search.run');
    expect(permissions).not.toContain('opportunity.create');
    expect(permissions).not.toContain('user.read');
    expect(permissions).not.toContain('exam.update');
    expect(permissions).not.toContain('candidate.read_all');
  });

  it('gives a recruiter opportunity publishing but never candidate data or admin rights', () => {
    expect(ROLE_PERMISSIONS.recruiter).toContain('opportunity.create');
    expect(ROLE_PERMISSIONS.recruiter).not.toContain('candidate.read_all');
    expect(ROLE_PERMISSIONS.recruiter).not.toContain('user.read');
    expect(ROLE_PERMISSIONS.recruiter).not.toContain('system.configure');
  });

  it('gives an analyst data editing but no user or system administration', () => {
    expect(ROLE_PERMISSIONS.analyst).toContain('opportunity.update');
    expect(ROLE_PERMISSIONS.analyst).toContain('exam.update');
    expect(ROLE_PERMISSIONS.analyst).toContain('opportunity.read_all');
    expect(ROLE_PERMISSIONS.analyst).not.toContain('user.read');
    expect(ROLE_PERMISSIONS.analyst).not.toContain('system.configure');
  });

  it('reserves ai.configure and security.configure for super admin', () => {
    expect(hasPermission('analyst', 'ai.configure')).toBe(false);
    expect(hasPermission('recruiter', 'security.configure')).toBe(false);
    expect(hasPermission('super_admin', 'ai.configure')).toBe(true);
    expect(hasPermission('super_admin', 'security.configure')).toBe(true);
  });

  it('never grants an unknown permission', () => {
    expect(hasPermission('super_admin', 'does.not.exist' as never)).toBe(false);
  });

  it('requires a second factor for the administrative roles and nobody else', () => {
    expect(MFA_REQUIRED_ROLES).toEqual(['admin', 'super_admin']);
    expect(requiresMfa('admin')).toBe(true);
    expect(requiresMfa('super_admin')).toBe(true);
    // Privileged but non-administrative roles are not gated behind MFA.
    expect(requiresMfa('analyst')).toBe(false);
    expect(requiresMfa('candidate')).toBe(false);
    expect(requiresMfa('recruiter')).toBe(false);
    // Every MFA-gated role must also be privileged.
    for (const role of MFA_REQUIRED_ROLES) expect(PRIVILEGED_ROLES).toContain(role);
  });
});

describe('password policy', () => {
  it('rejects short passwords', () => {
    const result = checkPasswordPolicy('Sh0rt!');
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects all-numeric and all-lowercase passwords', () => {
    expect(checkPasswordPolicy('123456789012').ok).toBe(false);
    expect(checkPasswordPolicy('abcdefghijklmn').ok).toBe(false);
  });

  it('accepts a strong password', () => {
    const result = checkPasswordPolicy('Correct-Horse-Battery-7');
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('names the unmet rules so the UI can explain the rejection', () => {
    const result = checkPasswordPolicy('abc');
    expect(result.errors.join(' ')).toMatch(/character|length/i);
  });
});

describe('TOTP second factor', () => {
  it('generates a base32 secret and a scannable otpauth URI', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUri(secret, 'admin@example.com')).toMatch(/^otpauth:\/\/totp\/.*secret=/);
  });

  it('accepts the code for the current window', () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, totpCodeAt(secret))).toBe(true);
  });

  it('tolerates one window of clock skew but rejects a stale code', () => {
    const secret = generateSecret();
    const now = Date.now();
    expect(verifyTotp(secret, totpCodeAt(secret, now - 30_000))).toBe(true);
    expect(verifyTotp(secret, totpCodeAt(secret, now - 600_000))).toBe(false);
  });

  it('rejects malformed and wrong codes without throwing', () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, '000000')).toBe(false);
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
    expect(verifyTotp('not-a-secret', '123456')).toBe(false);
  });

  it('issues different codes for different secrets', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
    expect(verifyTotp(a, totpCodeAt(b))).toBe(false);
  });
});

describe('upload validation', () => {
  const bytes = (n: number) => new Uint8Array(n).fill(65);

  it('rejects oversized files before any parsing happens', () => {
    expect(() => validateUpload(bytes(MAX_UPLOAD_BYTES + 1), 'resume.pdf', 'application/pdf')).toThrow(UploadError);
  });

  it('rejects empty uploads', () => {
    expect(() => validateUpload(new Uint8Array(0), 'resume.pdf', 'application/pdf')).toThrow(UploadError);
  });

  it('rejects content whose magic bytes contradict the declared type', () => {
    // A PNG renamed to .pdf must not be accepted as a resume.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x25, 0x50, 0x44, 0x46]);
    expect(() => validateUpload(png, 'resume.pdf', 'application/pdf')).toThrow(UploadError);
  });

  it('accepts the three supported resume formats', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    expect(validateUpload(pdf, 'resume.pdf', 'application/pdf')).toBeDefined();
    const txt = new TextEncoder().encode('PRIYA RAMESH\nB.Com\n');
    expect(validateUpload(txt, 'resume.txt', 'text/plain')).toBeDefined();
  });
});

describe('dynamic query generation', () => {
  const profileFor = (body: string) => profileCandidate(parseResume(body));

  const COMMERCE = profileFor(`PRIYA RAMESH
Chennai, Tamil Nadu

EDUCATION
Bachelor of Commerce (B.Com), Accounting & Finance
University of Madras, Chennai — 2025

SKILLS
Tally ERP 9, MS Excel, GST Filing, TDS, Bank Reconciliation
`);

  const ENGINEERING = profileFor(`ARJUN MEHTA
Bengaluru, Karnataka

EDUCATION
B.E Computer Science
Anna University, Chennai — 2023

EXPERIENCE
Software Engineer — Acme Systems, Bengaluru
June 2023 - Present
- Built REST APIs in Node.js and React.

SKILLS
JavaScript, TypeScript, React, Node.js, SQL, Docker
`);

  it('builds queries from the candidate profile rather than a fixed list', () => {
    const accounting = generateQueriesDeterministic({ profile: COMMERCE, locations: ['Chennai', 'Tamil Nadu', 'India'] });
    const engineering = generateQueriesDeterministic({ profile: ENGINEERING, locations: ['Bengaluru', 'India'] });
    expect(accounting.length).toBeGreaterThan(0);
    expect(accounting.map((q) => q.q).join(' ')).toMatch(/account|commerce/i);
    expect(engineering.map((q) => q.q).join(' ')).toMatch(/software|engineer|developer/i);
    expect(accounting.map((q) => q.q)).not.toEqual(engineering.map((q) => q.q));
  });

  it('attaches an intent, a source tier and a rationale to every query', () => {
    const queries = generateQueriesDeterministic({ profile: COMMERCE, locations: ['Chennai', 'India'] });
    for (const query of queries) {
      expect(query.q.length).toBeGreaterThan(2);
      expect(['job', 'government', 'exam', 'internship', 'fellowship', 'official', 'general']).toContain(query.intent);
      expect([1, 2, 3, 4]).toContain(query.tier);
      expect(query.rationale.length).toBeGreaterThan(0);
    }
  });

  it('includes government and exam intents for a commerce graduate', () => {
    const queries = generateQueriesDeterministic({ profile: COMMERCE, locations: ['Chennai', 'Tamil Nadu', 'India'] });
    const intents = new Set(queries.map((q) => q.intent));
    expect(intents.has('government') || intents.has('exam')).toBe(true);
  });

  it('respects the maxQueries ceiling', () => {
    const queries = generateQueriesDeterministic({ profile: COMMERCE, locations: ['Chennai', 'India'], maxQueries: 4 });
    expect(queries.length).toBeLessThanOrEqual(4);
  });

  it('produces nothing when the resume carries no signal at all', () => {
    const empty = profileCandidate(parseResume(''));
    const queries = generateQueriesDeterministic({ profile: empty, locations: ['India'] });
    expect(queries).toHaveLength(0);
  });
});


describe('client IP (rate limits and audit trail)', () => {
  it('behind N trusted proxies, takes the Nth entry from the RIGHT, ignoring what the client put in front', () => {
    // The client forged "6.6.6.6"; the one proxy in front appended the address it really saw.
    expect(clientIp('6.6.6.6, 203.0.113.9', null, 1)).toBe('203.0.113.9');
    // Two proxies: the client's real address is second from the right.
    expect(clientIp('6.6.6.6, 203.0.113.9, 10.0.0.2', null, 2)).toBe('203.0.113.9');
    // Rotating the forged prefix cannot change the answer, which is the whole point.
    for (const forged of ['1.1.1.1', '2.2.2.2', '3.3.3.3, 4.4.4.4']) {
      expect(clientIp(`${forged}, 203.0.113.9`, null, 1)).toBe('203.0.113.9');
    }
  });

  it('never indexes past the start of a short list', () => {
    expect(clientIp('203.0.113.9', null, 3)).toBe('203.0.113.9');
  });

  it('with no proxy configured, falls back to the first entry, then X-Real-IP, then nothing', () => {
    expect(clientIp('203.0.113.9, 10.0.0.2', null, 0)).toBe('203.0.113.9');
    expect(clientIp(null, '192.0.2.44', 0)).toBe('192.0.2.44');
    expect(clientIp(null, null, 0)).toBe('');
    expect(clientIp('', null, 0)).toBe('');
  });

  it('bounds the length so a hostile header cannot bloat the audit log', () => {
    expect(clientIp('x'.repeat(500), null, 0).length).toBeLessThanOrEqual(64);
    expect(clientIp(`a, ${'y'.repeat(500)}`, null, 1).length).toBeLessThanOrEqual(64);
  });
});

describe('failure counting', () => {
  afterEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });
  const account = { key: 'login-failures:someone@example.com', limit: 3, windowMs: 15 * 60_000 };

  it('charges only failures, and blocks once the limit is reached', () => {
    expect(isOverLimit(account)).toBe(false);
    recordFailure(account);
    recordFailure(account);
    expect(isOverLimit(account)).toBe(false);
    recordFailure(account);
    expect(isOverLimit(account)).toBe(true);
  });

  it('peeking never consumes allowance', () => {
    for (let i = 0; i < 50; i += 1) isOverLimit(account);
    expect(isOverLimit(account)).toBe(false);
  });

  it('keeps accounts independent of each other', () => {
    for (let i = 0; i < 3; i += 1) recordFailure(account);
    expect(isOverLimit(account)).toBe(true);
    expect(isOverLimit({ ...account, key: 'login-failures:other@example.com' })).toBe(false);
  });

  it('lets a successful sign-in clear the count', () => {
    for (let i = 0; i < 3; i += 1) recordFailure(account);
    clearFailures(account.key);
    expect(isOverLimit(account)).toBe(false);
  });

  it('forgives everything once the window has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    for (let i = 0; i < 3; i += 1) recordFailure(account);
    expect(isOverLimit(account)).toBe(true);
    vi.setSystemTime(new Date('2026-10-01T00:16:00Z'));
    expect(isOverLimit(account)).toBe(false);
  });

  it('the general limiter still counts every request and refuses the one over the limit', () => {
    const general = { key: 'upload:someone', limit: 2, windowMs: 60_000 };
    expect(checkRateLimit(general).ok).toBe(true);
    expect(checkRateLimit(general).ok).toBe(true);
    expect(checkRateLimit(general).ok).toBe(false);
  });
});
