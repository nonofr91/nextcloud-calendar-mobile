import dayjs from 'dayjs';
import {
  agendaDayDelta,
  agendaRowIndexAtContentY,
  agendaTargetDayAtContentY,
  shiftEventByDays,
} from '@/features/calendar/utils/agendaDragMath';
import type { CalendarEvent } from '@/types';

const HEADER_H = 57;
const ROW_H = 72;

/** Build rows+offsets like AgendaView: one header (57) + n item rows (72) per day. */
function buildLayout(days: { key: string; items: number }[]) {
  const rows: { type: 'header' | 'item'; key: string; date: Date }[] = [];
  const offsets: number[] = [];
  let y = 0;
  for (const d of days) {
    offsets.push(y); y += HEADER_H;
    rows.push({ type: 'header', key: d.key, date: dayjs(d.key).toDate() });
    for (let i = 0; i < d.items; i++) {
      offsets.push(y); y += ROW_H;
      rows.push({ type: 'item', key: d.key, date: dayjs(d.key).toDate() });
    }
  }
  return { rows, offsets };
}

describe('agendaDragMath', () => {
  const { rows, offsets } = buildLayout([
    { key: '2026-11-16', items: 2 },
    { key: '2026-11-17', items: 0 },
    { key: '2026-11-18', items: 1 },
  ]);
  // layout: h16@0, item@57, item@129, h17@201, h18@258, item@315

  it('locates the row under a content offset', () => {
    expect(agendaRowIndexAtContentY(offsets, 0)).toBe(0);
    expect(agendaRowIndexAtContentY(offsets, 60)).toBe(1);   // inside first item
    expect(agendaRowIndexAtContentY(offsets, 205)).toBe(3);  // 17 Nov header
    expect(agendaRowIndexAtContentY(offsets, 9999)).toBe(offsets.length - 1);
  });

  it('resolves the day under the finger, including empty days', () => {
    expect(agendaTargetDayAtContentY(offsets, rows, 60)).toBe('2026-11-16');
    expect(agendaTargetDayAtContentY(offsets, rows, 205)).toBe('2026-11-17'); // header of empty day
    expect(agendaTargetDayAtContentY(offsets, rows, 320)).toBe('2026-11-18');
  });

  it('computes whole-day deltas between day keys', () => {
    expect(agendaDayDelta('2026-11-16', '2026-11-18')).toBe(2);
    expect(agendaDayDelta('2026-11-18', '2026-11-16')).toBe(-2);
    expect(agendaDayDelta('2026-11-16', '2026-11-16')).toBe(0);
  });

  it('shifts an event by whole days preserving wall-clock times', () => {
    const event = {
      dtstart: new Date('2026-11-16T18:15:00'),
      dtend: new Date('2026-11-16T19:15:00'),
    } as CalendarEvent;
    const moved = shiftEventByDays(event, 2);
    expect(moved.dtstart.getHours()).toBe(18);
    expect(moved.dtstart.getMinutes()).toBe(15);
    expect(dayjs(moved.dtstart).format('YYYY-MM-DD')).toBe('2026-11-18');
    expect(moved.dtend.getTime() - moved.dtstart.getTime())
      .toBe(event.dtend.getTime() - event.dtstart.getTime());
  });

  it('keeps multi-day span duration when shifted', () => {
    const event = {
      dtstart: new Date('2026-11-16T09:00:00'),
      dtend: new Date('2026-11-18T17:00:00'),
    } as CalendarEvent;
    const moved = shiftEventByDays(event, 3);
    expect(moved.dtend.getTime() - moved.dtstart.getTime())
      .toBe(event.dtend.getTime() - event.dtstart.getTime());
  });
});
