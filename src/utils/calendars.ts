import { useAccountStore } from '@/stores/accountStore';
import type { CalendarMeta } from '@/types';

export function isWritableCalendar(c: CalendarMeta): boolean {
  return !c.isReadOnly && !c.isSubscribed && c.supportsEvents !== false;
}

// Calendar ids are the server's remote ids — unique only inside their account
// (`personal`, `contact_birthdays`… exist on every Nextcloud). The composite
// key is the safe identity wherever several accounts' calendars are handled
// together: pickers, per-calendar preferences, dedupe keys.
export function calendarKey(accountId: string, calendarId: string): string {
  return `${accountId}|${calendarId}`;
}

export function calendarKeyOf(c: Pick<CalendarMeta, 'accountId' | 'id'>): string {
  return calendarKey(c.accountId, c.id);
}

/**
 * Reads a per-calendar preference list (hidden, notif/widget-disabled,
 * availability overrides). Entries are composite keys; pre-multi-account
 * entries were bare remote ids recorded against the then-active account, so
 * they keep applying to the current active account only — never leaking to
 * every account sharing the id.
 */
export function hasCalendarFlag(
  list: readonly string[] | ReadonlySet<string>,
  accountId: string,
  calendarId: string,
): boolean {
  const has = (id: string) =>
    'has' in list ? list.has(id) : (list as readonly string[]).includes(id);
  if (has(calendarKey(accountId, calendarId))) return true;
  return has(calendarId) && useAccountStore.getState().activeAccountId === accountId;
}

export const CALENDAR_GROUPS = ['personal', 'shared', 'deck', 'tasks'] as const;
export type CalendarGroup = (typeof CALENDAR_GROUPS)[number];

export function calendarGroup(c: CalendarMeta): CalendarGroup {
  if (c.isShared) return 'shared';
  if (/app-generated--deck/i.test(c.url)) return 'deck';
  if (c.supportsEvents === false) return 'tasks';
  return 'personal';
}

export function byServerOrder(a: CalendarMeta, b: CalendarMeta): number {
  return (
    CALENDAR_GROUPS.indexOf(calendarGroup(a)) - CALENDAR_GROUPS.indexOf(calendarGroup(b)) ||
    (a.order ?? 0) - (b.order ?? 0)
  );
}
