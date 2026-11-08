import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { legacyBackedStorage } from '@/stores/legacyStorage';
import { setAppBadge } from '@/features/notifications/appBadge';
import type { OcsNotification } from '@/services/nextcloud/notifications';

export type CalendarNotification = OcsNotification & {
  seen: boolean;
  // notificationId is a per-server sequence — the owner account is required
  // to make an entry (and its dismissal/deep-link) unique across accounts.
  accountId: string;
};

interface NotificationState {
  notifications: CalendarNotification[];
  lastFetchedAt: number | null;
  unreadCount: number;
  setNotifications: (notifications: CalendarNotification[]) => void;
  addOrUpdateNotifications: (notifications: CalendarNotification[]) => void;
  markAsSeen: (accountId: string, notificationId: number) => void;
  removeNotification: (accountId: string, notificationId: number) => void;
  markAllSeen: () => void;
  clear: () => void;
  refreshBadge: () => void;
}

export function withSeenFlag(n: OcsNotification, accountId: string): CalendarNotification {
  return { ...n, seen: false, accountId };
}

const notifKey = (n: Pick<CalendarNotification, 'accountId' | 'notificationId'>) =>
  `${n.accountId}|${n.notificationId}`;

function updateBadgeCount(notifications: CalendarNotification[]): number {
  const count = notifications.filter((n) => !n.seen).length;
  void setAppBadge(count);
  return count;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      lastFetchedAt: null,
      unreadCount: 0,
      setNotifications: (notifications) => {
        const prev = get().notifications;
        const prevSeen = new Map(prev.map((n) => [notifKey(n), n.seen]));
        const merged = notifications.map((n) => ({ ...n, seen: prevSeen.get(notifKey(n)) ?? n.seen }));
        const unreadCount = updateBadgeCount(merged);
        set({ notifications: merged, unreadCount, lastFetchedAt: Date.now() });
      },
      addOrUpdateNotifications: (incoming) => {
        const current = get().notifications;
        const byId = new Map(current.map((n) => [notifKey(n), n]));
        for (const n of incoming) {
          const existing = byId.get(notifKey(n));
          byId.set(notifKey(n), { ...n, seen: existing?.seen ?? n.seen });
        }
        const notifications = Array.from(byId.values());
        const unreadCount = updateBadgeCount(notifications);
        set({ notifications, unreadCount, lastFetchedAt: Date.now() });
      },
      markAsSeen: (accountId, notificationId) => {
        const notifications = get().notifications.map((n) =>
          n.accountId === accountId && n.notificationId === notificationId ? { ...n, seen: true } : n,
        );
        const unreadCount = updateBadgeCount(notifications);
        set({ notifications, unreadCount });
      },
      removeNotification: (accountId, notificationId) => {
        const notifications = get().notifications.filter(
          (n) => !(n.accountId === accountId && n.notificationId === notificationId),
        );
        const unreadCount = updateBadgeCount(notifications);
        set({ notifications, unreadCount });
      },
      markAllSeen: () => {
        const notifications = get().notifications.map((n) => ({ ...n, seen: true }));
        const unreadCount = updateBadgeCount(notifications);
        set({ notifications, unreadCount });
      },
      clear: () => {
        updateBadgeCount([]);
        set({ notifications: [], unreadCount: 0, lastFetchedAt: null });
      },
      refreshBadge: () => {
        const unreadCount = updateBadgeCount(get().notifications);
        set({ unreadCount });
      },
    }),
    {
      name: 'notification-store',
      storage: createJSONStorage(() => legacyBackedStorage([])),
      partialize: (state) => ({
        notifications: state.notifications,
        lastFetchedAt: state.lastFetchedAt,
      }),
    },
  ),
);
