import { DatabaseSync } from 'node:sqlite';
import type { RunResult, SqlDriver } from './driver';
import { toSqliteParam } from './driver';

/**
 * SQLite driver built on Node's native `node:sqlite` module.
 * Synchronous under the hood; exposed through the same async surface as Postgres so
 * application code never has to care which engine it is talking to.
 */
export class SqliteDriver implements SqlDriver {
  readonly dialect = 'sqlite' as const;
  private db: DatabaseSync;
  private depth = 0;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  async query<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params.map(toSqliteParam));
    return rows as T[];
  }

  async one<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params.map(toSqliteParam));
    return (row as T) ?? null;
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...params.map(toSqliteParam));
    return { changes: Number(info.changes) };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(); // nested → participate in the outer transaction
    this.depth += 1;
    this.db.exec('BEGIN');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* rollback may fail if the txn already ended */
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
