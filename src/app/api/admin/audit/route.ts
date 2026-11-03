import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/auth/rbac';
import { listAuditLogs } from '@/lib/audit';
import { relativeTime } from '@/lib/opportunity/deadline';

export const dynamic = 'force-dynamic';

/** GET /api/admin/audit — append-only audit trail (admin+). */
export const GET = route(async (request) => {
  await requirePermission(request, 'audit.read');
  const url = new URL(request.url);
  const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 100));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const rows = await listAuditLogs(limit, offset, url.searchParams.get('action') ?? undefined);
  const total = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_logs');
  const actions = await db.query('SELECT action, COUNT(*) AS n FROM audit_logs GROUP BY action ORDER BY n DESC LIMIT 40');
  const security = await db.query('SELECT id, event, detail, ip_address, created_at FROM security_logs ORDER BY created_at DESC LIMIT 50');

  return json({
    entries: rows.map((row: any) => ({ ...row, createdAtAgo: relativeTime(row.created_at) })),
    total: Number(total?.n ?? 0),
    actions: actions.map((row: any) => ({ action: row.action, count: Number(row.n) })),
    security: security.map((row: any) => ({ ...row, createdAtAgo: relativeTime(row.created_at) })),
  });
}, { csrf: false });
