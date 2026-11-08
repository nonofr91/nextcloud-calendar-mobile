import { Appearance } from 'react-native';

import { useSettingsStore } from '@/stores/settingsStore';
import { resolveUse24h } from '@/utils/timeFormat';
import { useAccountStore, anyCalendarConfigured } from '@/stores/accountStore';
import { useCalendarStore } from '@/stores/calendarStore';

import { hasCalendarFlag } from '@/utils/calendars';
import { readUpcomingEvents, visibleAccountIdsToRead } from './readEvents';
import { buildAgendaTimeline, type BuildAgendaOptions } from './agendaSnapshot';
import type { AgendaTimelineEntry } from './types';

export const AGENDA_DAYS = 7;

export async function buildFreshTimeline(now: Date = new Date()): Promise<AgendaTimelineEntry[] | null> {
  const state = useAccountStore.getState();
  const visibleIds = visibleAccountIdsToRead();
  if (visibleIds.length === 0) return null;
  if (!anyCalendarConfigured(state, visibleIds)) return null;

  const { widgetDisabledCalendarIds } = useCalendarStore.getState();
  const events = (await readUpcomingEvents(AGENDA_DAYS, now))
    .filter((event) => !hasCalendarFlag(widgetDisabledCalendarIds, event.accountId, event.calendarId));
  const { language: locale, timeFormat } = useSettingsStore.getState();
  const use24h = resolveUse24h(timeFormat, locale);
  const scheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';

  const options: BuildAgendaOptions = { now, locale, scheme, use24h, days: AGENDA_DAYS, maxPerSection: 10 };
  return buildAgendaTimeline(events, options);
}
