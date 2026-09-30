import { useEffect } from 'react';
import { api } from './api';

/**
 * Browser notifications via the standard Notifications API.
 *
 * Scope, stated honestly: these fire while the app is open in a tab (it polls the same
 * in-app notification list the bell shows). They are not background push — that needs a
 * service worker and VAPID keys, which this app does not configure. Alerts that must reach
 * someone who is not in the app are what email is for.
 */

const SEEN_KEY = 'oaa_browser_notified';
const MAX_PER_POLL = 3;
const MAX_REMEMBERED = 200;
const POLL_MS = 60_000;

export type BrowserPermission = NotificationPermission | 'unsupported';

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
}

export function browserPermission(): BrowserPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

/** Must be called from a user gesture (a click), or browsers will refuse to show the prompt. */
export async function requestBrowserPermission(): Promise<BrowserPermission> {
  if (browserPermission() === 'unsupported') return 'unsupported';
  try {
    return await window.Notification.requestPermission();
  } catch {
    return browserPermission();
  }
}

function readSeen(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-MAX_REMEMBERED)));
  } catch {
    /* storage unavailable (private mode) — worst case an alert repeats */
  }
}

/**
 * Shows a desktop notification for each unread alert not shown before. Returns how many were
 * shown. Does nothing unless the user has granted permission.
 */
export function showUnseen(notifications: InAppNotification[]): number {
  if (browserPermission() !== 'granted') return 0;
  const seen = new Set(readSeen());
  const fresh = notifications.filter((item) => !item.read && !seen.has(item.id));
  const toShow = fresh.slice(0, MAX_PER_POLL);

  for (const item of toShow) {
    try {
      const popup = new window.Notification(item.title, { body: item.body, tag: item.id });
      popup.onclick = () => {
        window.focus();
        if (item.link) window.location.href = item.link;
        popup.close();
      };
    } catch {
      /* some browsers throw when constructing outside a secure context */
    }
  }
  // Everything unread is remembered, including what was over the per-poll cap: a backlog of old
  // alerts must not dribble out three at a time for the next half hour.
  writeSeen([...seen, ...fresh.map((item) => item.id)]);
  return toShow.length;
}

/** Polls the notification list while the app is open and the user has opted in. */
export function useBrowserNotifications(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || browserPermission() !== 'granted') return;
    let cancelled = false;
    const check = async () => {
      try {
        const data = await api.get<{ notifications: InAppNotification[] }>('/api/notifications');
        if (!cancelled) showUnseen(data.notifications);
      } catch {
        /* offline or signed out — try again on the next tick */
      }
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
}
