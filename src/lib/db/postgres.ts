import type { Pool } from 'pg';
import type { RunResult, SqlDriver } from './driver';
import { toPgParam, toPgPlaceholders } from './driver';

/**
 * PostgreSQL driver (`pg`). Selected automatically when DATABASE_URL starts with
 * postgres:// or postgresql://. `pg` is imported lazily so environments that only
 * use SQLite never pay for it.
 */
export class PostgresDriver implements SqlDriver {
  readonly dialect = 'postgres' as const;
  private pool: Pool;

  constructor(connectionString: string) {
    const { Pool: PgPool } = require('pg') as typeof import('pg');
    this.pool = new PgPool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }

  private translate(sql: string, params: unknown[]) {
    return { text: toPgPlaceholders(sql), values: params.map(toPgParam) };
  }

  async query<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { text, values } = this.translate(sql, params);
    const res = await this.pool.query(text, values);
    return res.rows as T[];
  }

  async one<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const { text, values } = this.translate(sql, params);
    const res = await this.pool.query(text, values);
    return { changes: res.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
