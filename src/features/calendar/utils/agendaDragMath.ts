import dayjs from 'dayjs';
import type { CalendarEvent } from '@/types';

/**
 * Row layout contract shared with AgendaView: `offsets[i]` is the content-Y of
 * `rows[i]`, every row carries the day key of its section. Keeping the type
 * structural avoids importing the component's internal Row type here.
 */
export interface AgendaDragRow {
  type: 'header' | 'item';
  key: string;
  date: Date;
  event?: CalendarEvent;
}

export function agendaRowIndexAtContentY(offsets: number[], contentY: number): number {
  if (offsets.length === 0) return -1;
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= contentY) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, Math.min(offsets.length - 1, lo - 1));
}

/**
 * The day a drag currently hovers: whichever section contains the row under the
 * finger. Returns null when the position is above/below all content.
 */
export function agendaTargetDayAtContentY(
  offsets: number[],
  rows: AgendaDragRow[],
  contentY: number,
): string | null {
  const idx = agendaRowIndexAtContentY(offsets, contentY);
  if (idx < 0 || idx >= rows.length) return null;
  return rows[idx].key;
}

/** Whole-day delta between two agenda day keys (`YYYY-MM-DD`). */
export function agendaDayDelta(fromKey: string, toKey: string): number {
  return dayjs(toKey).startOf('day').diff(dayjs(fromKey).startOf('day'), 'day');
}

/**
 * Shift an event by whole calendar days, preserving wall-clock start/end
 * (dayjs `add(…, 'day')` stays DST-safe) — matches the grid's day-column move.
 */
export function shiftEventByDays(
  event: CalendarEvent,
  dayDelta: number,
): { dtstart: Date; dtend: Date } {
  return {
    dtstart: dayjs(event.dtstart).add(dayDelta, 'day').toDate(),
    dtend: dayjs(event.dtend).add(dayDelta, 'day').toDate(),
  };
}
