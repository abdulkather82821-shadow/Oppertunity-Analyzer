'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { api } from '@/lib/client/api';

interface Notification {
  id: string;
  channel: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAtAgo: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get<{ notifications: Notification[]; unread: number }>('/api/notifications')
      .then((data) => {
        setItems(data.notifications);
        setUnread(data.unread);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const markAll = async () => {
    await api.patch('/api/notifications');
    load();
  };

  const markOne = async (id: string) => {
    await api.patch(`/api/notifications?id=${id}`);
    load();
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Notifications"
        subtitle={`${unread} unread`}
        actions={
          unread > 0 ? (
            <button onClick={() => void markAll()} className="btn-secondary">
              <CheckCheck className="h-4 w-4" /> Mark all read
            </button>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="Deadline reminders, exam stage changes and new high-match alerts will appear here. Enable them in Settings."
          action={
            <Link href="/settings" className="btn-primary">
              Notification settings
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className={`card card-pad ${item.read ? 'opacity-70' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{item.title}</p>
                  <p className="muted mt-0.5 text-xs">{item.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{item.kind.replace(/_/g, ' ')}</Badge>
                    <Badge tone="muted">{item.channel.replace(/_/g, ' ')}</Badge>
                    <span className="text-xs text-ink-400">{item.createdAtAgo}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.link ? (
                    <Link href={item.link} className="btn-secondary btn-sm">
                      Open
                    </Link>
                  ) : null}
                  {!item.read ? (
                    <button onClick={() => void markOne(item.id)} className="btn-ghost btn-sm">
                      Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
