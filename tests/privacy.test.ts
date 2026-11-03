import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTempDb } from './helpers/db';
import { db, insertRow, nowIso, uid } from '@/lib/db';
import { audit, logSecurity } from '@/lib/audit';
import { UploadError } from '@/lib/parsing/extract';

// Read when the storage module is first imported (below), so they must be set before that.
const uploadDir = mkdtempSync(path.join(os.tmpdir(), 'oaa-uploads-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.ENCRYPTION_KEY = 'privacy-test-key-0123456789-abcdefghijklmnop';

useTempDb();

/**
 * Privacy and accountability.
 *
 * A resume is private data: encrypted on disk, readable only by its owner, and when its owner
 * deletes it (or their account) nothing derived from it may linger. The one deliberate
 * exception is an administrator's audit trail, which is anonymised rather than erased so that
 * deleting an account cannot be used to destroy evidence.
 */

let storage: typeof import('@/lib/services/profile-service');
let accounts: typeof import('@/lib/services/account-service');

beforeAll(async () => {
  storage = await import('@/lib/services/profile-service');
  accounts = await import('@/lib/services/account-service');
});

afterEach(() => vi.unstubAllEnvs());

const PDF = new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'sample-resume.pdf')));
const files = () => readdirSync(uploadDir).filter((name) => !name.startsWith('.'));
const count = async (sql: string, ...params: unknown[]) => Number((await db.one<{ n: number }>(sql, params))?.n ?? 0);

async function makeUser(role = 'candidate') {
  const id = uid();
  const now = nowIso();
  await insertRow('users', { id, email: `${role}-${id.slice(0, 6)}@example.test`, name: `Test ${role}`, role, password_hash: 'x', created_at: now, updated_at: now });
  return id;
}

async function upload(userId: string) {
  return storage.storeResume(userId, { name: 'resume.pdf', type: 'application/pdf', bytes: PDF });
}

describe('resume storage', () => {
  it('stores the file encrypted: no plaintext and no PDF header on disk', async () => {
    const owner = await makeUser();
    const { resume } = await upload(owner);
    expect(files()).toContain(`${resume.id}.pdf`);
    const onDisk = readFileSync(path.join(uploadDir, `${resume.id}.pdf`));
    expect(onDisk.subarray(0, 4).toString()).not.toBe('%PDF');
    expect(onDisk.includes('PRIYA')).toBe(false);
    const row = await db.one<any>('SELECT storage_encrypted, original_name FROM resumes WHERE id = ?', [resume.id]);
    expect(Number(row.storage_encrypted)).toBe(1);
  });

  it('gives the owner their exact original back, and nobody else anything', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { resume } = await upload(owner);
    const back = await storage.readResumeFile(resume.id, owner);
    expect(back && Buffer.from(back).equals(Buffer.from(PDF))).toBe(true);
    expect(await storage.readResumeFile(resume.id, stranger)).toBeNull();
  });

  it('never stores a path derived from the uploaded file name', async () => {
    const owner = await makeUser();
    const evil = await storage.storeResume(owner, { name: '../../etc/passwd.pdf', type: 'application/pdf', bytes: PDF });
    const row = await db.one<any>('SELECT storage_path FROM resumes WHERE id = ?', [evil.resume.id]);
    expect(row.storage_path).toBe(`${evil.resume.id}.pdf`);
    expect(existsSync(path.join(uploadDir, row.storage_path))).toBe(true);
    expect(files().every((name) => !name.includes('passwd'))).toBe(true);
  });

  it('does not report an unreadable stored file as "not found" silently, but as a logged fault', async () => {
    const owner = await makeUser();
    const { resume } = await upload(owner);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('ENCRYPTION_KEY', 'a-different-key-entirely-0123456789-abcdef');
    expect(await storage.readResumeFile(resume.id, owner)).toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('deleting a resume', () => {
  it('removes the file, the row, and the profile and records derived from it', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const mine = await upload(owner);
    const theirs = await upload(other);
    const profileId = mine.profileId;
    expect(await count('SELECT COUNT(*) AS n FROM education WHERE profile_id = ?', profileId)).toBeGreaterThan(0);
    await insertRow('resume_optimizations', { id: uid(), user_id: owner, resume_id: mine.resume.id, score: 50, ats_score: 50, result: '{}', created_at: nowIso() });

    expect(await storage.deleteResume(mine.resume.id, owner)).toBe(true);

    expect(files()).not.toContain(`${mine.resume.id}.pdf`);
    expect(await count('SELECT COUNT(*) AS n FROM resumes WHERE id = ?', mine.resume.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM candidate_profiles WHERE id = ?', profileId)).toBe(0);
    for (const table of ['education', 'experiences', 'skills', 'certifications', 'projects']) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_id = ?`, profileId), table).toBe(0);
    }
    expect(await count('SELECT COUNT(*) AS n FROM resume_optimizations WHERE resume_id = ?', mine.resume.id)).toBe(0);

    // Someone else's resume and profile are untouched.
    expect(files()).toContain(`${theirs.resume.id}.pdf`);
    expect(await count('SELECT COUNT(*) AS n FROM candidate_profiles WHERE id = ?', theirs.profileId)).toBe(1);
  });

  it("will not delete another user's resume", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { resume } = await upload(owner);
    expect(await storage.deleteResume(resume.id, stranger)).toBe(false);
    expect(files()).toContain(`${resume.id}.pdf`);
  });
});

describe('malware verdicts', () => {
  it('refuses an infected upload with a clear error and stores nothing', async () => {
    const server = net.createServer((socket) => {
      socket.on('data', () => undefined);
      // Answer once the terminating zero-length chunk has arrived.
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.subarray(buffer.length - 4).equals(Buffer.alloc(4))) socket.end('stream: Eicar-Test-Signature FOUND\0');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    vi.stubEnv('CLAMD_HOST', '127.0.0.1');
    vi.stubEnv('CLAMD_PORT', String(port));
    try {
      const owner = await makeUser();
      const before = files().length;
      const rows = await count('SELECT COUNT(*) AS n FROM resumes WHERE user_id = ?', owner);
      const attempt = upload(owner);
      await expect(attempt).rejects.toBeInstanceOf(UploadError);
      await expect(attempt).rejects.toMatchObject({ code: 'malware_detected' });
      expect(files().length).toBe(before);
      expect(await count('SELECT COUNT(*) AS n FROM resumes WHERE user_id = ?', owner)).toBe(rows);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('deleting an account', () => {
  async function populate(role: string) {
    const id = await makeUser(role);
    const { resume, profileId } = await upload(id);
    await insertRow('user_settings', { user_id: id, updated_at: nowIso() });
    await insertRow('sessions', { id: uid(), user_id: id, token_hash: uid(), expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: nowIso() });
    await audit({ userId: id, action: 'exam.update', resourceType: 'government_exam', resourceId: 'x', newValue: { vacancies: 99 }, ip: '203.0.113.5', sessionId: 's1' });
    await logSecurity({ userId: id, event: 'login_success', detail: `role=${role}`, ip: '203.0.113.5' });
    return { id, resume, profileId };
  }

  it("erases a candidate's resume, profile, settings, sessions and logs, and anonymises the account", async () => {
    const bystander = await populate('candidate');
    const leaver = await populate('candidate');

    const result = await accounts.deleteAccount({ id: leaver.id, role: 'candidate' }, { ip: '203.0.113.5' });
    expect(result.resumesRemoved).toBe(1);

    expect(files()).not.toContain(`${leaver.resume.id}.pdf`);
    expect(await count('SELECT COUNT(*) AS n FROM resumes WHERE user_id = ?', leaver.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM candidate_profiles WHERE user_id = ?', leaver.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?', leaver.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', leaver.id)).toBe(0);

    const tombstone = await db.one<any>('SELECT * FROM users WHERE id = ?', [leaver.id]);
    expect(tombstone.status).toBe('deleted');
    expect(tombstone.email).toMatch(/@deleted\.invalid$/);
    expect(tombstone.name).toBe('Deleted user');
    expect(tombstone.password_hash).toBeNull();

    // A candidate's own log rows go; only the fact of deletion remains, with no address.
    const remaining = await db.query<any>('SELECT action, ip_address FROM audit_logs WHERE user_id = ?', [leaver.id]);
    expect(remaining.map((r) => r.action)).toEqual(['user.delete']);
    expect(remaining[0].ip_address).toBe('');

    // Another user is untouched.
    expect(files()).toContain(`${bystander.resume.id}.pdf`);
    expect(await count('SELECT COUNT(*) AS n FROM candidate_profiles WHERE user_id = ?', bystander.id)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', bystander.id)).toBe(1);
  });

  it("anonymises a privileged user's audit trail instead of erasing it", async () => {
    const analyst = await populate('analyst');
    await accounts.deleteAccount({ id: analyst.id, role: 'analyst' }, { ip: '203.0.113.5' });

    const trail = await db.query<any>('SELECT action, actor_email, actor_role, ip_address, session_id, new_value FROM audit_logs WHERE user_id = ? ORDER BY created_at', [analyst.id]);
    // The action they took is still on record...
    const edit = trail.find((row) => row.action === 'exam.update');
    expect(edit).toBeDefined();
    expect(JSON.parse(edit.new_value)).toEqual({ vacancies: 99 });
    expect(edit.actor_role).toBe('analyst');
    // ...but who-and-where is gone.
    expect(edit.actor_email).toBe('deleted user');
    expect(edit.ip_address).toBe('');
    expect(edit.session_id).toBe('');
    const security = await db.query<any>('SELECT ip_address FROM security_logs WHERE user_id = ?', [analyst.id]);
    expect(security.length).toBeGreaterThan(0);
    expect(security.every((row) => row.ip_address === '')).toBe(true);
  });

  it('will not let the last active super admin delete themselves', async () => {
    const only = await makeUser('super_admin');
    await expect(accounts.deleteAccount({ id: only, role: 'super_admin' })).rejects.toMatchObject({ status: 409, code: 'last_super_admin' });
    const still = await db.one<any>('SELECT status FROM users WHERE id = ?', [only]);
    expect(still.status).toBe('active');

    // With another active super admin in place, it is allowed.
    await makeUser('super_admin');
    await db.run("UPDATE users SET role = 'admin' WHERE role = 'super_admin' AND id <> ? AND id NOT IN (SELECT id FROM users ORDER BY created_at DESC LIMIT 1)", [only]);
    await expect(accounts.deleteAccount({ id: only, role: 'super_admin' })).resolves.toMatchObject({ resumesRemoved: 0 });
  });
});
