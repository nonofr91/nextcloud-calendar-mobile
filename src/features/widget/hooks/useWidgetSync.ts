import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAccountStore, anyCalendarConfigured } from '@/stores/accountStore';
import { useVisibleAccountIds } from '@/hooks/useAccounts';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { EVENT_OBSERVED_COLUMNS } from '@/database/observedColumns';

import { observeAgendaEventsQuery, observeMonthWidgetEventsQuery } from '../core/readEvents';
import { AGENDA_DAYS } from '../core/buildTimeline';
import { liveActivity } from '../surfaces/liveActivity';
import { registerWidgetBackgroundSync, unregisterWidgetBackgroundSync } from '../sync/backgroundSync';
import { syncWidget } from '../sync/syncWidget';

const REFRESH_MS = 60_000;

export function useWidgetSync(): void {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const calendarApp = useAccountStore((s) => (anyCalendarConfigured(s, s.visibleAccountIds ?? []) ? 'configured' : 'unconfigured'));
  const hiddenCalendarIds = useCalendarStore((s) => s.hiddenCalendarIds);
  const notifDisabledCalendarIds = useCalendarStore((s) => s.notifDisabledCalendarIds);
  const widgetDisabledCalendarIds = useCalendarStore((s) => s.widgetDisabledCalendarIds);
  const monthWidgetFontSize = useCalendarStore((s) => s.monthWidgetFontSize);
  const monthWidgetFontWeight = useCalendarStore((s) => s.monthWidgetFontWeight);
  const monthWidgetTheme = useCalendarStore((s) => s.monthWidgetTheme);
  const monthWidgetCardStyle = useCalendarStore((s) => s.monthWidgetCardStyle);
  const monthWidgetDayTap = useCalendarStore((s) => s.monthWidgetDayTap);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const language = useSettingsStore((s) => s.language);
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn);
  const visibleAccountIds = useVisibleAccountIds();
  const visibleKey = visibleAccountIds.join(',');
  const prevKeyRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (activeAccountId) void syncWidget();
  }, [
    hiddenCalendarIds,
    notifDisabledCalendarIds,
    widgetDisabledCalendarIds,
    monthWidgetFontSize,
    monthWidgetFontWeight,
    monthWidgetTheme,
    monthWidgetCardStyle,
    monthWidgetDayTap,
    activeAccountId,
    calendarApp,
    timeFormat,
    language,
    weekStartsOn,
  ]);

  useEffect(() => {
    // The widget surface resets when the default account OR the visible set
    // changes — its timeline is rebuilt from the merged rows either way.
    const key = `${activeAccountId ?? ''}|${visibleKey}`;
    const prevKey = prevKeyRef.current;
    prevKeyRef.current = key;
    const accountChanged = prevKey !== undefined && prevKey !== key;

    if (!activeAccountId || visibleAccountIds.length === 0) {
      if (accountChanged) void liveActivity.clear().catch(() => undefined);
      void unregisterWidgetBackgroundSync();
      return;
    }

    void (async () => {
      try {
        if (accountChanged) await liveActivity.clear();
        await liveActivity.requestPermission?.();
        await syncWidget();
      } catch {
      }
    })();
    void registerWidgetBackgroundSync();

    const sub = observeAgendaEventsQuery(visibleAccountIds, AGENDA_DAYS)
      .observeWithColumns(EVENT_OBSERVED_COLUMNS)
      .subscribe(() => {
        void syncWidget();
      });

    const monthSub = observeMonthWidgetEventsQuery(visibleAccountIds)
      .observeWithColumns(EVENT_OBSERVED_COLUMNS)
      .subscribe(() => {
        void syncWidget();
      });

    const tick = setInterval(() => {
      void syncWidget();
    }, REFRESH_MS);

    const onAppState = (status: AppStateStatus) => {
      if (status === 'active') void syncWidget();
    };
    const appSub = AppState.addEventListener('change', onAppState);

    return () => {
      sub.unsubscribe();
      monthSub.unsubscribe();
      clearInterval(tick);
      appSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, visibleKey]);
}
