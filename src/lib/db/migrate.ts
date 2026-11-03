import fs from 'node:fs';
import path from 'node:path';
import type { SqlDriver } from './driver';

const MIGRATION_ID = '0001_initial_schema';

/**
 * Additive column migrations.
 *
 * The base schema is applied once, but `CREATE TABLE IF NOT EXISTS` cannot add a column to a
 * table that already exists. Each entry below is idempotent: the column is only added when it
 * is genuinely missing, so re-running migrations against an existing database is safe.
 */
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'candidate_profiles', column: 'parse_warnings', ddl: "ALTER TABLE candidate_profiles ADD COLUMN parse_warnings TEXT NOT NULL DEFAULT '[]'" },
  { table: 'opportunities', column: 'eligibility_status', ddl: "ALTER TABLE opportunities ADD COLUMN eligibility_status TEXT NOT NULL DEFAULT 'unknown'" },
  { table: 'opportunities', column: 'eligibility_reason', ddl: "ALTER TABLE opportunities ADD COLUMN eligibility_reason TEXT NOT NULL DEFAULT ''" },
  { table: 'opportunities', column: 'match_strengths', ddl: "ALTER TABLE opportunities ADD COLUMN match_strengths TEXT NOT NULL DEFAULT '[]'" },
  { table: 'opportunities', column: 'match_gaps', ddl: "ALTER TABLE opportunities ADD COLUMN match_gaps TEXT NOT NULL DEFAULT '[]'" },
  { table: 'opportunities', column: 'explanation', ddl: "ALTER TABLE opportunities ADD COLUMN explanation TEXT NOT NULL DEFAULT ''" },
  { table: 'opportunities', column: 'source_tier', ddl: 'ALTER TABLE opportunities ADD COLUMN source_tier SMALLINT' },
  { table: 'opportunities', column: 'source_type', ddl: "ALTER TABLE opportunities ADD COLUMN source_type TEXT NOT NULL DEFAULT 'secondary'" },
  { table: 'opportunities', column: 'salary_period', ddl: 'ALTER TABLE opportunities ADD COLUMN salary_period TEXT' },
  { table: 'opportunities', column: 'selection_process', ddl: "ALTER TABLE opportunities ADD COLUMN selection_process TEXT NOT NULL DEFAULT '[]'" },
  { table: 'opportunities', column: 'application_fee', ddl: 'ALTER TABLE opportunities ADD COLUMN application_fee TEXT' },
  { table: 'opportunities', column: 'nationality', ddl: 'ALTER TABLE opportunities ADD COLUMN nationality TEXT' },
  { table: 'opportunities', column: 'admit_card_date', ddl: 'ALTER TABLE opportunities ADD COLUMN admit_card_date TEXT' },
  { table: 'opportunities', column: 'result_date', ddl: 'ALTER TABLE opportunities ADD COLUMN result_date TEXT' },
  { table: 'opportunities', column: 'result_status', ddl: 'ALTER TABLE opportunities ADD COLUMN result_status TEXT' },
  { table: 'opportunities', column: 'official_notification', ddl: 'ALTER TABLE opportunities ADD COLUMN official_notification TEXT' },
  { table: 'government_exams', column: 'admit_card_date', ddl: 'ALTER TABLE government_exams ADD COLUMN admit_card_date TEXT' },
  { table: 'government_exams', column: 'answer_key_date', ddl: 'ALTER TABLE government_exams ADD COLUMN answer_key_date TEXT' },
  { table: 'government_exams', column: 'result_date', ddl: 'ALTER TABLE government_exams ADD COLUMN result_date TEXT' },
  { table: 'government_exams', column: 'interview_date', ddl: 'ALTER TABLE government_exams ADD COLUMN interview_date TEXT' },
  { table: 'government_exams', column: 'final_result_date', ddl: 'ALTER TABLE government_exams ADD COLUMN final_result_date TEXT' },
  { table: 'government_exams', column: 'posts', ddl: "ALTER TABLE government_exams ADD COLUMN posts TEXT NOT NULL DEFAULT '[]'" },
  { table: 'government_exams', column: 'pay_scale', ddl: 'ALTER TABLE government_exams ADD COLUMN pay_scale TEXT' },
  { table: 'government_exams', column: 'exam_mode', ddl: 'ALTER TABLE government_exams ADD COLUMN exam_mode TEXT' },
  { table: 'government_exams', column: 'eligibility_details', ddl: 'ALTER TABLE government_exams ADD COLUMN eligibility_details TEXT' },
  { table: 'government_exams', column: 'syllabus', ddl: 'ALTER TABLE government_exams ADD COLUMN syllabus TEXT' },
  { table: 'government_exams', column: 'next_verification', ddl: 'ALTER TABLE government_exams ADD COLUMN next_verification TEXT' },
  { table: 'government_exams', column: 'timeline', ddl: "ALTER TABLE government_exams ADD COLUMN timeline TEXT NOT NULL DEFAULT '[]'" },
  { table: 'user_settings', column: 'scoring_weights', ddl: 'ALTER TABLE user_settings ADD COLUMN scoring_weights TEXT' },
  { table: 'user_settings', column: 'organization_id', ddl: 'ALTER TABLE user_settings ADD COLUMN organization_id TEXT' },
  { table: 'user_settings', column: 'preferred_job_types', ddl: "ALTER TABLE user_settings ADD COLUMN preferred_job_types TEXT NOT NULL DEFAULT '[]'" },
  { table: 'search_jobs', column: 'matched', ddl: 'ALTER TABLE search_jobs ADD COLUMN matched INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'mfa_secret', ddl: 'ALTER TABLE users ADD COLUMN mfa_secret TEXT' },
  { table: 'users', column: 'mfa_enrolled_at', ddl: 'ALTER TABLE users ADD COLUMN mfa_enrolled_at TEXT' },
  { table: 'sessions', column: 'mfa_verified_at', ddl: 'ALTER TABLE sessions ADD COLUMN mfa_verified_at TEXT' },
];

/** Returns the set of columns that already exist on a table, lower-cased. */
async function existingColumns(driver: SqlDriver, table: string): Promise<Set<string>> {
  const dialect = (driver as unknown as { dialect?: string }).dialect;
  if (dialect === 'postgres') {
    const rows = await driver.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = ?`,
      [table],
    );
    return new Set(rows.map((row) => row.column_name.toLowerCase()));
  }
  // SQLite: PRAGMA cannot be parameter-bound, and `table` comes from the constant list above.
  const rows = await driver.query<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name.toLowerCase()));
}

/**
 * Applies the portable schema, then any additive column migrations.
 * Statements are split on `;` at end-of-line so the same DDL file runs unchanged on SQLite
 * and PostgreSQL.
 */
export async function runMigrations(driver: SqlDriver): Promise<{ applied: boolean; id: string; columnsAdded: number }> {
  await driver.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const existing = await driver.one<{ id: string }>('SELECT id FROM schema_migrations WHERE id = ?', [MIGRATION_ID]);
  let applied = false;

  if (!existing) {
    const file = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
    const sql = fs.readFileSync(file, 'utf8');
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    await driver.transaction(async () => {
      for (const statement of statements) {
        const cleaned = statement
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim();
        if (!cleaned) continue;
        await driver.exec(`${cleaned};`);
      }
      await driver.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
        MIGRATION_ID,
        new Date().toISOString(),
      ]);
    });
    applied = true;
  }

  // Additive migrations run on every boot; they are no-ops once the columns exist.
  let columnsAdded = 0;
  const cache = new Map<string, Set<string>>();
  for (const migration of COLUMN_MIGRATIONS) {
    if (!cache.has(migration.table)) {
      try {
        cache.set(migration.table, await existingColumns(driver, migration.table));
      } catch {
        continue; // table not present in this deployment
      }
    }
    const columns = cache.get(migration.table)!;
    if (columns.has(migration.column.toLowerCase())) continue;
    try {
      await driver.exec(`${migration.ddl};`);
      columns.add(migration.column.toLowerCase());
      columnsAdded += 1;
    } catch {
      // A concurrent boot may have added it first; the next check will see it.
    }
  }

  return { applied, id: MIGRATION_ID, columnsAdded };
}
