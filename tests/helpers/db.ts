import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Gives a test file its own throw-away SQLite database.
 *
 * The driver is created lazily from SQLITE_DIR, so pointing that at a fresh temp directory
 * before the first query isolates the file completely from `data/app.db`. Vitest runs each
 * test file in its own module registry, so the cached driver never leaks between files.
 */
export function useTempDb(): void {
  let dir = '';
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'oaa-test-'));
    process.env.SQLITE_DIR = dir;
    delete process.env.DATABASE_URL;
    const { resetDriver, ensureMigrated } = await import('@/lib/db');
    await resetDriver();
    await ensureMigrated();
  });
  afterAll(async () => {
    const { resetDriver } = await import('@/lib/db');
    await resetDriver();
    rmSync(dir, { recursive: true, force: true });
  });
}
