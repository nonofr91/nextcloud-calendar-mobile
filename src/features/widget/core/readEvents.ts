import { Q } from '@nozbe/watermelondb';

import type { CalendarEvent } from '@/types';
import { database } from '@/database';
import Calendar from '@/database/models/Calendar';
import Event from '@/database/models/Event';
import { mapEventToShared } from '@/database/mappers/event';
import { useAccountStore } from '@/stores/accountStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { getAccounts } from '@/hooks/useAccounts';
import { normalizeEvents } from '@/utils/normalizeEvent';
import { calendarKey, hasCalendarFlag } from '@/utils/calendars';

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDayAfter(d: Date, days: number): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days + 1).getTime();
}

// Non-hook equivalent of useVisibleAccountIds: the persisted subset wins,
// otherwise every connected account.
export function visibleAccountIdsToRead(): string[] {
  const { visibleAccountIds } = useAccountStore.getState();
  if (visibleAccountIds) return visibleAccountIds;
  return getAccounts().map((a) => a.id);
}

function eventsInRangeQuery(accountIds: readonly string[], rangeStart: number, rangeEnd: number) {
  return database
    .get<Event>('events')
    .query(
      Q.where('account_id', Q.oneOf([...accountIds])),
      Q.where('start', Q.lt(rangeEnd)),
      Q.where('end', Q.gte(rangeStart)),
    );
}

export async function readUpcomingEvents(days: number, now: Date = new Date()): Promise<CalendarEvent[]> {
  const accountIds = visibleAccountIdsToRead();
  if (accountIds.length === 0) return [];

  const hidden = useCalendarStore.getState().hiddenCalendarIds;
  const rows = await eventsInRangeQuery(accountIds, startOfDay(now), endOfDayAfter(now, days)).fetch();

  return normalizeEvents(
    rows
      .map(mapEventToShared)
      .filter((e) => !hasCalendarFlag(hidden, e.accountId, e.calendarId)),
  );
}

export async function readWidgetEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]> {
  const accountIds = visibleAccountIdsToRead();
  if (accountIds.length === 0) return [];

  const hidden = useCalendarStore.getState().hiddenCalendarIds;
  const disabled = useCalendarStore.getState().widgetDisabledCalendarIds;
  const rows = await eventsInRangeQuery(accountIds, rangeStart.getTime(), rangeEnd.getTime()).fetch();

  return normalizeEvents(
    rows
      .map(mapEventToShared)
      .filter(
        (event) =>
          !hasCalendarFlag(hidden, event.accountId, event.calendarId) &&
          !hasCalendarFlag(disabled, event.accountId, event.calendarId),
      ),
  );
}

export async function readContactBirthdayCalendarIds(): Promise<Set<string>> {
  const accountIds = visibleAccountIdsToRead();
  if (accountIds.length === 0) return new Set();

  const rows = await database
    .get<Calendar>('calendars')
    .query(Q.where('account_id', Q.oneOf(accountIds)))
    .fetch();

  return new Set(
    rows
      .filter((calendar) =>
        [calendar.remoteId, calendar.slug, calendar.url]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes('contact_birthdays')),
      )
      .map((calendar) => calendarKey(calendar.accountId, calendar.remoteId)),
  );
}

export function observeTodayEventsQuery(accountIds: readonly string[], now: Date = new Date()) {
  return eventsInRangeQuery(accountIds, startOfDay(now), endOfDayAfter(now, 0));
}

export function observeAgendaEventsQuery(accountIds: readonly string[], days: number, now: Date = new Date()) {
  return eventsInRangeQuery(accountIds, startOfDay(now), endOfDayAfter(now, days));
}

// The month widget grid covers up to ~41 days back (week-start padding at the
// end of a month) and ~42 days ahead, so a ±45-day rolling window around today
// catches edits anywhere on the currently displayed month regardless of the
// configured first day of week.
export function observeMonthWidgetEventsQuery(accountIds: readonly string[], now: Date = new Date()) {
  const pad = 45 * 86_400_000;
  return eventsInRangeQuery(accountIds, startOfDay(now) - pad, endOfDayAfter(now, 45));
}
