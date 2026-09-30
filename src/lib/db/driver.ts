/**
 * Database driver abstraction.
 *
 * The application ships two interchangeable drivers:
 *   - `sqlite`   → Node's built-in `node:sqlite` (zero native dependencies, great for dev/preview)
 *   - `postgres` → PostgreSQL via `pg` (production target, selected with DATABASE_URL)
 *
 * Both execute the *same* parameterised SQL. To keep the dialect identical we deliberately
 * restrict the schema to the portable subset:
 *   TEXT ids (UUID strings generated in app code, never SERIAL/gen_random_uuid)
 *   SMALLINT 0/1 instead of native BOOLEAN
 *   TEXT ISO-8601 UTC strings instead of TIMESTAMPTZ
 *   TEXT JSON payloads instead of JSON/JSONB
 * Every statement is parameterised, which is also our SQL-injection defence.
 */

export type Dialect = 'sqlite' | 'postgres';

export interface RunResult {
  changes: number;
}

export interface SqlDriver {
  readonly dialect: Dialect;
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** SQLite (node:sqlite) only accepts null | number | bigint | string | Uint8Array. */
export function toSqliteParam(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  return JSON.stringify(value);
}

/** Rewrite portable `?` placeholders into Postgres `$n` placeholders. */
export function toPgPlaceholders(sql: string): string {
  let index = 0;
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';
    if (char === "'" && !inDouble && prev !== '\\') inSingle = !inSingle;
    if (char === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    if (char === '?' && !inSingle && !inDouble) {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += char;
  }
  return out;
}

export function toPgParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function parseDbUrl(url: string | undefined): { dialect: Dialect; connectionString?: string; path?: string } {
  const value = (url ?? process.env.DATABASE_URL ?? '').trim();
  if (!value) return { dialect: 'sqlite', path: defaultSqlitePath() };
  if (value.startsWith('postgres://') || value.startsWith('postgresql://')) {
    return { dialect: 'postgres', connectionString: value };
  }
  if (value.startsWith('sqlite://')) return { dialect: 'sqlite', path: value.slice('sqlite://'.length) };
  return { dialect: 'sqlite', path: value };
}

export function defaultSqlitePath(): string {
  const path = require('node:path') as typeof import('node:path');
  const fs = require('node:fs') as typeof import('node:fs');
  const dir = process.env.SQLITE_DIR ?? path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'app.db');
}
