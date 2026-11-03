import { db, nowIso, uid } from '@/lib/db';

export interface AuditEntry {
  userId?: string | null;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ip?: string;
  sessionId?: string;
}

/**
 * Append-only audit trail. Records who did what, to which resource, and the before/after
 * values. There is no UPDATE or DELETE path for these rows anywhere in the codebase —
 * that is deliberate: the log is meant to be immutable.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    let actorEmail = entry.actorEmail ?? '';
    let actorRole = entry.actorRole ?? '';
    if (entry.userId && (!actorEmail || !actorRole)) {
      const actor = await db.one<{ email: string; role: string }>('SELECT email, role FROM users WHERE id = ?', [entry.userId]);
      if (actor) {
        actorEmail = actorEmail || actor.email;
        actorRole = actorRole || actor.role;
      }
    }
    await db.run(
      `INSERT INTO audit_logs (id, user_id, actor_email, actor_role, action, resource_type, resource_id,
                               previous_value, new_value, reason, ip_address, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid(),
        entry.userId ?? null,
        actorEmail,
        actorRole,
        entry.action,
        entry.resourceType ?? '',
        entry.resourceId ?? '',
        entry.previousValue === undefined ? null : JSON.stringify(entry.previousValue),
        entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
        entry.reason ?? '',
        entry.ip ?? '',
        entry.sessionId ?? '',
        nowIso(),
      ],
    );
  } catch (error) {
    // Auditing must never break the primary operation, but failures must be visible.
    console.error('[audit] failed to write audit entry:', error);
  }
}

export async function logSecurity(entry: {
  userId?: string | null;
  event: string;
  detail?: string;
  ip?: string;
}): Promise<void> {
  try {
    await db.run(
      'INSERT INTO security_logs (id, user_id, event, detail, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uid(), entry.userId ?? null, entry.event, entry.detail ?? '', entry.ip ?? '', nowIso()],
    );
  } catch (error) {
    console.error('[audit] failed to write security log:', error);
  }
}

export async function trackEvent(userId: string | null, event: string, props: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.run('INSERT INTO analytics_events (id, user_id, event, props, created_at) VALUES (?, ?, ?, ?, ?)', [
      uid(),
      userId,
      event,
      JSON.stringify(props),
      nowIso(),
    ]);
  } catch (error) {
    console.error('[analytics] failed to record event:', error);
  }
}

export async function listAuditLogs(limit = 100, offset = 0, action?: string) {
  const params: unknown[] = [];
  let where = '';
  if (action) {
    where = 'WHERE action = ?';
    params.push(action);
  }
  const rows = await db.query(
    `SELECT id, user_id, actor_email, actor_role, action, resource_type, resource_id,
            previous_value, new_value, reason, ip_address, session_id, created_at
       FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows;
}
