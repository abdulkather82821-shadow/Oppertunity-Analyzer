/**
 * Granular permission catalogue + role → permission map.
 *
 * Roles never grant blanket access: every capability is an explicit permission string,
 * which is what the API layer checks (`requirePermission`). The frontend may hide UI for
 * usability, but authorisation is always decided here, on the server.
 */

export const PERMISSIONS = [
  // profile
  'profile.read',
  'profile.update',
  'profile.delete',
  // resume
  'resume.upload',
  'resume.read',
  'resume.update',
  'resume.delete',
  'resume.analyze',
  'resume.download',
  'resume.read_any',
  // opportunity
  'opportunity.read',
  'opportunity.create',
  'opportunity.update',
  'opportunity.delete',
  'opportunity.verify',
  'opportunity.archive',
  'opportunity.merge_duplicates',
  'opportunity.read_all',
  // exam
  'exam.read',
  'exam.create',
  'exam.update',
  'exam.verify',
  'exam.delete',
  // source
  'source.read',
  'source.create',
  'source.verify',
  'source.flag',
  // applications / saved
  'application.create',
  'application.read',
  'application.update',
  'application.delete',
  'application.read_for_organization',
  'application.read_all',
  'saved.manage',
  'feedback.create',
  // notifications
  'notification.read',
  'notification.manage',
  // search
  'search.run',
  'search.read_logs',
  // users
  'user.read',
  'user.create',
  'user.update',
  'user.suspend',
  'user.delete',
  'user.manage_roles',
  'recruiter.verify',
  // ai / system / security / data
  'ai.use',
  'ai.configure',
  'system.read',
  'system.configure',
  'analytics.read',
  'security.read',
  'security.configure',
  'database.manage',
  'audit.read',
  'data.export',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'candidate',
  'recruiter',
  'analyst',
  'moderator',
  'admin',
  'super_admin',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  candidate: '👤 Candidate',
  recruiter: '🏢 Verified Recruiter',
  analyst: '🔎 Data / Opportunity Analyst',
  moderator: '🛡️ Moderator / Support',
  admin: '⚙️ Platform Admin',
  super_admin: '👑 Super Admin',
};

/**
 * Role hierarchy (informational — for UI ordering and escalation guards).
 * Permissions are still resolved individually, never by inheritance.
 */
export const ROLE_RANK: Record<Role, number> = {
  candidate: 10,
  recruiter: 20,
  moderator: 30,
  analyst: 40,
  admin: 50,
  super_admin: 60,
};

const CANDIDATE: Permission[] = [
  'profile.read', 'profile.update', 'profile.delete',
  'resume.upload', 'resume.read', 'resume.update', 'resume.delete', 'resume.analyze', 'resume.download',
  'opportunity.read', 'exam.read', 'source.read',
  'application.create', 'application.read', 'application.update', 'application.delete',
  'saved.manage', 'feedback.create',
  'notification.read', 'notification.manage',
  'search.run',
  'ai.use',
];

const RECRUITER: Permission[] = [
  'profile.read', 'profile.update',
  'opportunity.read', 'opportunity.create', 'opportunity.update', 'opportunity.archive',
  'exam.read', 'source.read',
  'application.read_for_organization',
  'notification.read', 'notification.manage',
];

const ANALYST: Permission[] = [
  'profile.read', 'profile.update',
  'opportunity.read', 'opportunity.read_all', 'opportunity.create', 'opportunity.update',
  'opportunity.verify', 'opportunity.archive', 'opportunity.merge_duplicates',
  'exam.read', 'exam.create', 'exam.update', 'exam.verify',
  'source.read', 'source.create', 'source.verify', 'source.flag',
  'search.run', 'search.read_logs',
  'system.read',
  'analytics.read',
  'feedback.create',
];

const MODERATOR: Permission[] = [
  'profile.read',
  'opportunity.read', 'opportunity.read_all', 'opportunity.archive',
  'exam.read',
  'source.read', 'source.flag',
  'feedback.create',
  'user.read',
  'system.read',
];

const ADMIN: Permission[] = [
  'profile.read', 'profile.update',
  'opportunity.read', 'opportunity.read_all', 'opportunity.create', 'opportunity.update',
  'opportunity.delete', 'opportunity.verify', 'opportunity.archive', 'opportunity.merge_duplicates',
  'exam.read', 'exam.create', 'exam.update', 'exam.verify', 'exam.delete',
  'source.read', 'source.create', 'source.verify', 'source.flag',
  'application.read_all',
  'search.run', 'search.read_logs',
  'user.read', 'user.update', 'user.suspend', 'recruiter.verify',
  'analytics.read', 'audit.read',
  'system.read',
  'security.read',
  'notification.read', 'notification.manage',
];

const SUPER_ADMIN: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  candidate: CANDIDATE,
  recruiter: RECRUITER,
  analyst: ANALYST,
  moderator: MODERATOR,
  admin: ADMIN,
  super_admin: SUPER_ADMIN,
};

/** Roles that may only be granted by a super_admin (escalation protection). */
export const PRIVILEGED_ROLES: Role[] = ['analyst', 'moderator', 'admin', 'super_admin'];

/** Roles that require a second factor at login. */
export const MFA_REQUIRED_ROLES: Role[] = ['admin', 'super_admin'];

export function permissionsFor(role: Role | string): Permission[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}

export function hasPermission(role: Role | string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function isPrivilegedRole(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role as Role);
}

export function requiresMfa(role: string): boolean {
  return MFA_REQUIRED_ROLES.includes(role as Role);
}
