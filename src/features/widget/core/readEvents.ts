import { Q } from '@nozbe/watermelondb';

import type { CalendarEvent } from '@/types';
import { database } from '@/database';
import Calendar from '@/database/models/Calendar';
import Event from '@/database/models/Event';
import { mapEventToShared } from '@/database/mappers/event';
import { useAccountStore } from '@/stores/accountStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { normalizeEvents } from '@/utils/normalizeEvent';

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDayAfter(d: Date, days: number): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days + 1).getTime();
}

function eventsInRangeQuery(accountId: string, rangeStart: number, rangeEnd: number) {
  return database
    .get<Event>('events')
    .query(
      Q.where('account_id', accountId),
      Q.where('start', Q.lt(rangeEnd)),
      Q.where('end', Q.gte(rangeStart)),
    );
}

async function readDeckCalendarIds(accountId: string): Promise<Set<string>> {
  const rows = await database
    .get<Calendar>('calendars')
    .query(Q.where('account_id', accountId))
    .fetch();
  return new Set(
    rows
      .filter((calendar) => /app-generated--deck/i.test(calendar.url ?? ''))
      .map((calendar) => calendar.remoteId),
  );
}

export async function readUpcomingEvents(days: number, now: Date = new Date()): Promise<CalendarEvent[]> {
  const accountId = useAccountStore.getState().activeAccountId;
  if (!accountId) return [];

  const { hiddenCalendarIds: hidden, showDeckCards } = useCalendarStore.getState();
  const deckIds = showDeckCards ? null : await readDeckCalendarIds(accountId);
  const rows = await eventsInRangeQuery(accountId, startOfDay(now), endOfDayAfter(now, days)).fetch();

  return normalizeEvents(
    rows
      .map(mapEventToShared)
      .filter((e) => !hidden.includes(e.calendarId) && (!deckIds || !deckIds.has(e.calendarId))),
  );
}

export function observeTodayEventsQuery(accountId: string, now: Date = new Date()) {
  return eventsInRangeQuery(accountId, startOfDay(now), endOfDayAfter(now, 0));
}

export function observeAgendaEventsQuery(accountId: string, days: number, now: Date = new Date()) {
  return eventsInRangeQuery(accountId, startOfDay(now), endOfDayAfter(now, days));
}
