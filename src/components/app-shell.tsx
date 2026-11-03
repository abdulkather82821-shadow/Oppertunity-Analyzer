'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  Bell,
  Briefcase,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  X,
} from 'lucide-react';
import { api, type MeResponse } from '@/lib/client/api';
import { useBrowserNotifications } from '@/lib/client/browser-notifications';

const CANDIDATE_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/government', label: 'Government', icon: Landmark },
  { href: '/exams', label: 'Exams', icon: ScrollText },
  { href: '/saved', label: 'Saved', icon: Target },
  { href: '/applications', label: 'Applications', icon: FileText },
  { href: '/skills', label: 'Skill Gap', icon: Sparkles },
  { href: '/career-roadmap', label: 'Roadmap', icon: Target },
  { href: '/resume', label: 'Resume', icon: FileText },
];

const ADMIN_NAV = [{ href: '/admin', label: 'Admin', icon: ShieldCheck }];

export function useMe() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<MeResponse>('/api/auth/me')
      .then((data) => active && setMe(data))
      .catch(() => active && setMe(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { me, setMe, loading };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading } = useMe();
  const [open, setOpen] = useState(false);
  // Desktop alerts while the app is open, for users who opted in and granted permission.
  useBrowserNotifications(Boolean(me?.settings?.notifyBrowser) && me?.features?.browserNotifications !== false);

  const user = me?.user;
  const nav = user ? [...CANDIDATE_NAV, ...(user.permissions.includes('system.read') || user.permissions.includes('audit.read') ? ADMIN_NAV : [])] : [];

  const logout = async () => {
    await api.post('/api/auth/logout');
    router.push('/login');
    router.refresh();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button className="btn-ghost -ml-2 lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Target className="h-4 w-4" />
            </span>
            <span className="hidden text-sm font-semibold text-ink-900 sm:block">Opportunity Analyzer AI</span>
          </Link>

          <nav className="ml-4 hidden flex-1 items-center gap-0.5 lg:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                  pathname?.startsWith(item.href) ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link href="/chat" className="btn-ghost btn-sm" title="AI assistant">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Assistant</span>
            </Link>
            <Link href="/notifications" className="btn-ghost btn-sm relative" title="Notifications">
              <Bell className="h-4 w-4" />
              {me && me.unreadNotifications > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {me.unreadNotifications > 9 ? '9+' : me.unreadNotifications}
                </span>
              ) : null}
            </Link>
            <Link href="/upload" className="btn-primary btn-sm">
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Upload resume</span>
            </Link>
            <Link href="/settings" className="btn-ghost btn-sm" title={user?.name ?? user?.email ?? 'Account'}>
              <span className="hidden max-w-[10rem] truncate text-xs sm:inline">{user?.name || user?.email}</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-100 text-[10px] font-semibold text-ink-600">
                {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
              </span>
            </Link>
            <button onClick={logout} className="btn-ghost btn-sm" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {open ? (
          <nav className="grid grid-cols-2 gap-1 border-t border-ink-200 p-3 lg:hidden">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                  pathname?.startsWith(item.href) ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
            <Link href="/chat" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">
              <MessageSquare className="h-4 w-4" /> Assistant
            </Link>
            <Link href="/notifications" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">
              <Bell className="h-4 w-4" /> Notifications
            </Link>
            <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">
              <Settings className="h-4 w-4" /> Settings
            </Link>
          </nav>
        ) : null}
      </header>

      {me?.features?.maintenance && !(user?.role === 'admin' || user?.role === 'super_admin') ? (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          The platform is in maintenance mode. You can keep browsing, but changes are paused for now.
        </div>
      ) : null}
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-2">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-ink-200 bg-white px-4 py-3 text-xs text-ink-500">
          <p className="max-w-2xl leading-relaxed">
            <strong className="text-ink-700">Accuracy disclaimer:</strong> Opportunity Analyzer AI is a discovery assistant, not an official authority.
            Every record shows its source and last-verified time. Always confirm dates, eligibility and vacancies against the official notification before applying.
          </p>
          <p className="text-ink-400">Resumes are encrypted at rest and never shared publicly.</p>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle ? <p className="muted mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
