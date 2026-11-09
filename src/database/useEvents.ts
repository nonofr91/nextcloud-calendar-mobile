import { Q } from '@nozbe/watermelondb';
import { useEffect, useRef, useState } from 'react';

import type { CalendarEvent } from '@/types';

import { useDatabase } from './DatabaseProvider';
import { mapEventToShared } from './mappers/event';
import { EVENT_OBSERVED_COLUMNS } from './observedColumns';
import Event from './models/Event';

function rowKey(r: Event): string {
  return JSON.stringify([
    r.id,
    r.accountId,
    r.calendarId,
    r.uid,
    r.href,
    r.summary,
    r.description ?? null,
    r.location ?? null,
    r.start,
    r.end,
    !!r.allDay,
    r.color,
    r.attendees ?? null,
    r.organizerEmail ?? null,
    r.talkUrl ?? null,
    r.geo ?? null,
    !!r.isRecurring,
    r.rrule ?? null,
    r.recurrenceId ?? null,
    r.alarmMinutes ?? null,
    !!r.isTask,
    r.transp ?? null,
    r.status ?? null,
  ]);
}

function eventsFingerprint(rows: Event[]): string {
  if (rows.length === 0) return '';
  const keys = new Array<string>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    keys[i] = rowKey(rows[i]);
  }
  keys.sort();
  return keys.join('\0');
}

export function useEventsForRange(accountIds: readonly string[], start: Date, end: Date, refresh = 0) {
  const database = useDatabase();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const fingerprintRef = useRef<string>('');
  const idsKey = accountIds.join('\0');

  useEffect(() => {
    const ids = idsKey ? idsKey.split('\0') : [];
    if (ids.length === 0) {
      fingerprintRef.current = '';
      setEvents([]);
      return;
    }
    const query = database.get<Event>('events').query(
      Q.where('account_id', Q.oneOf(ids)),
      Q.where('start', Q.lt(end.getTime())),
      Q.where('end', Q.gte(start.getTime())),
    );
    const subscription = query.observeWithColumns(EVENT_OBSERVED_COLUMNS).subscribe((rows) => {
      const fingerprint = eventsFingerprint(rows);
      if (fingerprint === fingerprintRef.current) {
        return;
      }
      fingerprintRef.current = fingerprint;
      const next = rows
        .map(mapEventToShared)
        .sort((a, b) => a.dtstart.getTime() - b.dtstart.getTime());
      setEvents(next);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, start, end, database, refresh]);

  return events;
}

export function useAllEvents(accountIds: readonly string[]) {
  const database = useDatabase();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const idsKey = accountIds.join('\0');

  useEffect(() => {
    const ids = idsKey ? idsKey.split('\0') : [];
    if (ids.length === 0) {
      setEvents([]);
      return;
    }
    const subscription = database
      .get<Event>('events')
      .query(Q.where('account_id', Q.oneOf(ids)))
      .observeWithColumns(EVENT_OBSERVED_COLUMNS)
      .subscribe((rows) => setEvents(rows.map(mapEventToShared)));
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, database]);

  return events;
}
