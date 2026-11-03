// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserPermission, requestBrowserPermission, showUnseen, type InAppNotification } from '@/lib/client/browser-notifications';

/**
 * Browser notifications.
 *
 * Contract: nothing is ever shown without the user's permission, an alert is shown once, and a
 * backlog of old alerts never floods the desktop.
 */

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static shown: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: NotificationOptions = {},
  ) {
    FakeNotification.shown.push(this);
  }
}

const install = (permission: NotificationPermission | 'absent') => {
  FakeNotification.shown = [];
  if (permission === 'absent') {
    // A browser with no Notifications API at all.
    delete (window as unknown as Record<string, unknown>).Notification;
    return;
  }
  FakeNotification.permission = permission;
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
};

const alert = (id: string, over: Partial<InAppNotification> = {}): InAppNotification => ({
  id,
  title: `Deadline tomorrow — ${id}`,
  body: 'Applications close soon.',
  link: `/opportunity/${id}`,
  read: false,
  ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  install('granted');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('permission', () => {
  it('reports what the browser reports, and "unsupported" when there is no API', () => {
    install('default');
    expect(browserPermission()).toBe('default');
    install('denied');
    expect(browserPermission()).toBe('denied');
    install('absent');
    expect(browserPermission()).toBe('unsupported');
  });

  it('asks the browser for permission and returns its answer', async () => {
    install('default');
    FakeNotification.requestPermission.mockResolvedValueOnce('granted');
    expect(await requestBrowserPermission()).toBe('granted');
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the API is missing or the prompt fails', async () => {
    install('absent');
    expect(await requestBrowserPermission()).toBe('unsupported');
    install('default');
    FakeNotification.requestPermission.mockRejectedValueOnce(new Error('blocked by policy'));
    expect(await requestBrowserPermission()).toBe('default');
  });
});

describe('showing alerts', () => {
  it('shows nothing without permission, whatever the setting says', () => {
    for (const state of ['default', 'denied', 'absent'] as const) {
      install(state);
      expect(showUnseen([alert('a')])).toBe(0);
      expect(FakeNotification.shown).toHaveLength(0);
    }
  });

  it('shows each unread alert once, with its title and body', () => {
    expect(showUnseen([alert('one'), alert('two')])).toBe(2);
    expect(FakeNotification.shown.map((n) => n.title)).toEqual(['Deadline tomorrow — one', 'Deadline tomorrow — two']);
    expect(FakeNotification.shown[0].options.body).toBe('Applications close soon.');
    // The next poll sees the same list and must not repeat them.
    expect(showUnseen([alert('one'), alert('two')])).toBe(0);
    expect(FakeNotification.shown).toHaveLength(2);
  });

  it('skips alerts the user has already read', () => {
    expect(showUnseen([alert('read', { read: true }), alert('unread')])).toBe(1);
    expect(FakeNotification.shown[0].title).toMatch(/unread/);
  });

  it('shows new alerts that arrive after earlier ones', () => {
    showUnseen([alert('a')]);
    expect(showUnseen([alert('a'), alert('b')])).toBe(1);
    expect(FakeNotification.shown.map((n) => n.options.tag)).toEqual(['a', 'b']);
  });

  it('caps a burst at three and does not let the rest dribble out later', () => {
    const backlog = ['1', '2', '3', '4', '5', '6'].map((id) => alert(id));
    expect(showUnseen(backlog)).toBe(3);
    // Everything in the backlog was marked seen, so the next poll is silent.
    expect(showUnseen(backlog)).toBe(0);
    expect(FakeNotification.shown).toHaveLength(3);
  });

  it('opens the alert when it is clicked', () => {
    const location = { href: '/dashboard' };
    Object.defineProperty(window, 'location', { value: location, configurable: true, writable: true });
    window.focus = vi.fn();
    showUnseen([alert('click-me')]);
    const popup = FakeNotification.shown[0];
    popup.onclick?.();
    expect(location.href).toBe('/opportunity/click-me');
    expect(popup.close).toHaveBeenCalled();
  });

  it('survives unusable local storage instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => showUnseen([alert('private-mode')])).not.toThrow();
    expect(FakeNotification.shown).toHaveLength(1);
  });

  it('survives a browser that refuses to construct the notification', () => {
    const Throwing = class {
      static permission: NotificationPermission = 'granted';
      constructor() {
        throw new TypeError('Illegal constructor');
      }
    };
    Object.defineProperty(window, 'Notification', { value: Throwing, configurable: true, writable: true });
    expect(() => showUnseen([alert('x')])).not.toThrow();
  });
});
