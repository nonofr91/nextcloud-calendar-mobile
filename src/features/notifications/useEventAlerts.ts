import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useVisibleAccountIds } from '@/hooks/useAccounts';
import { EVENT_OBSERVED_COLUMNS } from '@/database/observedColumns';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { observeTodayEventsQuery } from '@/features/widget/core/readEvents';

import { scheduleEventAlerts } from './scheduleAlerts';

export function useEventAlerts(): void {
  const visibleAccountIds = useVisibleAccountIds();
  const visibleKey = visibleAccountIds.join(',');
  const timedAlerts = useSettingsStore((s) => s.timedAlerts);
  const allDayAlerts = useSettingsStore((s) => s.allDayAlerts);
  const notifDisabledCalendarIds = useCalendarStore((s) => s.notifDisabledCalendarIds);

  useEffect(() => {
    if (visibleAccountIds.length === 0) return;

    void scheduleEventAlerts();

    const sub = observeTodayEventsQuery(visibleAccountIds)
      .observeWithColumns(EVENT_OBSERVED_COLUMNS)
      .subscribe(() => {
        void scheduleEventAlerts();
      });

    const onAppState = (status: AppStateStatus) => {
      if (status === 'active') void scheduleEventAlerts();
    };
    const appSub = AppState.addEventListener('change', onAppState);

    return () => {
      sub.unsubscribe();
      appSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, timedAlerts, allDayAlerts, notifDisabledCalendarIds]);
}
