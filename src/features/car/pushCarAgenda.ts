import dayjs from 'dayjs';
import { requireOptionalNativeModule } from 'expo';
import i18n from 'i18next';
import { Platform } from 'react-native';

import type { CalendarEvent, CalendarMeta } from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';

interface NcmCarModule {
  setAgenda(json: string): boolean;
  notifyUpcoming(json: string): boolean;
}

const NcmCar = requireOptionalNativeModule<NcmCarModule>('NcmCar');

const MAX_ITEMS = 20;
const DEFAULT_NOTIFY_WINDOW_MIN = 45;
const notifiedUids = new Set<string>();

interface CarAgendaItem {
  title: string;
  dayKey: string;
  dayLabel: string;
  timeText: string;
  calName: string;
  accountName: string;
  location: string;
  description: string;
  geoLat: number | null;
  geoLon: number | null;
  talkUrl: string;
  startTs: number;
  endTs: number;
  allDay: boolean;
}

function fmtTime(ev: CalendarEvent): string {
  if (ev.allDay) return i18n.t('calendar.allDay');
  return `${dayjs(ev.dtstart).format('HH:mm')} – ${dayjs(ev.dtend).format('HH:mm')}`;
}

function dayLabel(d: dayjs.Dayjs, now: dayjs.Dayjs): string {
  if (d.isSame(now, 'day')) return i18n.t('calendar.today');
  if (d.isSame(now.add(1, 'day'), 'day')) return i18n.t('search.date.tomorrow');
  return d.format('dddd D MMM');
}

export function pushCarAgenda(
  events: CalendarEvent[],
  calendars: CalendarMeta[],
  accountNameById?: Map<string, string>,
): void {
  if (Platform.OS !== 'android' || !NcmCar) return;
  try {
    const nameById = new Map(calendars.map((c) => [c.id, c.displayName] as const));
    const now = dayjs();
    const upcoming: CarAgendaItem[] = events
      .filter((e) => !e.isTask && dayjs(e.dtend).valueOf() >= now.valueOf())
      .sort((a, b) => dayjs(a.dtstart).valueOf() - dayjs(b.dtstart).valueOf())
      .slice(0, MAX_ITEMS)
      .map((e) => {
        const start = dayjs(e.dtstart);
        return {
          title: e.summary || '(sans titre)',
          dayKey: start.format('YYYY-MM-DD'),
          dayLabel: dayLabel(start, now),
          timeText: fmtTime(e),
          calName: nameById.get(e.calendarId) ?? '',
          accountName: accountNameById?.get(e.accountId) ?? '',
          location: e.location ?? '',
          description: (e.description ?? '').slice(0, 300),
          geoLat: e.geo?.lat ?? null,
          geoLon: e.geo?.lon ?? null,
          talkUrl: e.talkUrl ?? '',
          startTs: dayjs(e.dtstart).valueOf(),
          endTs: dayjs(e.dtend).valueOf(),
          allDay: e.allDay,
        };
      });
    NcmCar.setAgenda(JSON.stringify(upcoming));
    maybeNotify(events, upcoming, now);
  } catch {
    // Car surface is best-effort — never break the app over it.
  }
}

/** Posts a car notification for events starting within the configured window (once per uid). */
function maybeNotify(events: CalendarEvent[], items: CarAgendaItem[], now: dayjs.Dayjs): void {
  const settings = useSettingsStore.getState();
  if (!settings.carNotificationsEnabled) return;
  const windowMin = settings.carNotifyWindowMin || DEFAULT_NOTIFY_WINDOW_MIN;
  const minimal = settings.carNotifyMinimal;
  const upcoming = events
    .filter((e) => !e.isTask)
    .filter((e) => {
      const start = dayjs(e.dtstart).valueOf();
      return start >= now.valueOf() && start <= now.add(windowMin, 'minute').valueOf();
    })
    .sort((a, b) => dayjs(a.dtstart).valueOf() - dayjs(b.dtstart).valueOf());

  for (const e of upcoming.slice(0, 2)) {
    const key = `${e.uid}|${dayjs(e.dtstart).valueOf()}`;
    if (notifiedUids.has(key)) continue;
    notifiedUids.add(key);
    const item = items.find((i) => i.title === (e.summary || '(sans titre)'));
    const time = e.allDay ? i18n.t('calendar.allDay') : dayjs(e.dtstart).format('HH:mm');
    // Minimal mode keeps the HUN text location-free (privacy on shared car screens).
    const geoUri = e.geo
      ? `geo:${e.geo.lat},${e.geo.lon}`
      : e.location
        ? `geo:0,0?q=${encodeURIComponent(e.location)}`
        : '';
    NcmCar?.notifyUpcoming(
      JSON.stringify({
        notifId: Math.abs(hashCode(key)),
        title: e.summary || '(sans titre)',
        text: minimal || !e.location ? time : `${time} · ${e.location}`,
        speakText: `${item?.dayLabel ?? ''} ${item?.timeText ?? ''} : ${e.summary ?? ''}`.trim(),
        geoUri,
      }),
    );
    return; // one notification per push is enough
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
