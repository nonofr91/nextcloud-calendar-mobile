import type { Account, CalendarEvent } from '@/types';
import { isEventPending } from '@/utils/eventPending';

export interface GridEvent {
  title: string;
  start: Date;
  end: Date;
  color: string;
  isPending?: boolean;
  _event: CalendarEvent;
}

export function gridEventKey(e: CalendarEvent): string {
  return `${e.accountId}|${e.calendarId}|${e.uid}|${e.dtstart.getTime()}`;
}

export function toGridEvents(events: CalendarEvent[], accounts?: readonly Account[]): GridEvent[] {
  const seen = new Set<string>();
  const out: GridEvent[] = [];
  for (const e of events) {
    const key = gridEventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    // Pending writes are namespaced per account — resolve the event's owner.
    const owner = accounts?.find((a) => a.id === e.accountId) ?? null;
    out.push({
      title: e.summary,
      start: e.dtstart,
      end: e.dtend,
      color: e.color,
      isPending: isEventPending(e, owner),
      _event: e,
    });
  }
  return out;
}
