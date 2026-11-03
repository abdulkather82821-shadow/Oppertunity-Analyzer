import { randomUUID } from 'node:crypto';
import type { SqlDriver } from './driver';
import { parseDbUrl } from './driver';
// `node:sqlite` ships with Node, so importing it statically is free. Only the Postgres driver
// (which drags in `pg`) stays a lazy require.
import { SqliteDriver } from './sqlite';

let driver: SqlDriver | null = null;
let migrated = false;

export function getDriver(): SqlDriver {
  if (!driver) {
    const target = parseDbUrl(process.env.DATABASE_URL);
    if (target.dialect === 'postgres') {
      // Lazily required so SQLite-only deployments never load `pg`.
      const { PostgresDriver } = require('./postgres') as typeof import('./postgres');
      driver = new PostgresDriver(target.connectionString!);
    } else {
      driver = new SqliteDriver(target.path!);
    }
  }
  return driver;
}

export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  const { runMigrations } = await import('./migrate');
  await runMigrations(getDriver());
  migrated = true;
}

/** Test/CLI helper: drop the cached driver (e.g. after switching DATABASE_URL). */
export async function resetDriver(): Promise<void> {
  if (driver) await driver.close();
  driver = null;
  migrated = false;
}

export const uid = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();

export function jsonEncode(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function jsonDecode<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function jsonList<T = string>(value: unknown): T[] {
  const decoded = jsonDecode<T[]>(value, []);
  return Array.isArray(decoded) ? decoded : [];
}

/** SQLite returns numbers as number; Postgres returns bigint/number. Normalise to number|null. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't';
}

/** Convenience facade so call sites read `db.query(...)` regardless of engine. */
export const db = {
  get dialect() {
    return getDriver().dialect;
  },
  query: <T = Record<string, any>>(sql: string, params?: unknown[]) => getDriver().query<T>(sql, params),
  one: <T = Record<string, any>>(sql: string, params?: unknown[]) => getDriver().one<T>(sql, params),
  run: (sql: string, params?: unknown[]) => getDriver().run(sql, params),
  exec: (sql: string) => getDriver().exec(sql),
  transaction: <T>(fn: () => Promise<T>) => getDriver().transaction(fn),
  close: async () => {
    if (driver) await driver.close();
    driver = null;
    migrated = false;
  },
};

/**
 * Inserts a row from a plain object. Column names always come from code (never from user
 * input) and every value is bound as a parameter, so this stays injection-safe while
 * removing the placeholder-counting errors that wide positional inserts invite.
 */
export async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  if (keys.length === 0) throw new Error(`insertRow(${table}): no columns supplied`);
  const columns = keys.join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  await db.run(
    `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`,
    keys.map((key) => row[key] ?? null),
  );
}

/** Same as insertRow but replaces any existing row with the same primary key. */
export async function replaceRow(table: string, row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  const columns = keys.join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const updates = keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ');
  await db.run(
    `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
    keys.map((key) => row[key] ?? null),
  );
}
