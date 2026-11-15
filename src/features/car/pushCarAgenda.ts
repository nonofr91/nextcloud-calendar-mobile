import dayjs from 'dayjs';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { CalendarEvent, CalendarMeta } from '@/types';

interface NcmCarModule {
  setAgenda(json: string): boolean;
}

const NcmCar = requireOptionalNativeModule<NcmCarModule>('NcmCar');

const MAX_ITEMS = 12;

function fmtTime(ev: CalendarEvent): string {
  if (ev.allDay) return 'Journée';
  return `${dayjs(ev.dtstart).format('HH:mm')} – ${dayjs(ev.dtend).format('HH:mm')}`;
}

export function pushCarAgenda(events: CalendarEvent[], calendars: CalendarMeta[]): void {
  if (Platform.OS !== 'android' || !NcmCar) return;
  try {
    const nameById = new Map(calendars.map((c) => [c.id, c.displayName] as const));
    const now = Date.now();
    const upcoming = events
      .filter((e) => !e.isTask && e.dtend.getTime() >= now)
      .sort((a, b) => a.dtstart.getTime() - b.dtstart.getTime())
      .slice(0, MAX_ITEMS)
      .map((e) => ({
        title: e.summary || '(sans titre)',
        subtitle: `${fmtTime(e)} · ${nameById.get(e.calendarId) ?? ''}`.trim(),
        meta: dayjs(e.dtstart).format('ddd D MMM'),
      }));
    NcmCar.setAgenda(JSON.stringify(upcoming));
  } catch {
    // Car surface is best-effort — never break the app over it.
  }
}
