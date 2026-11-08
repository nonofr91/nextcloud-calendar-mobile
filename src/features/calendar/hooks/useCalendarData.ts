import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';

import { syncVisibleRange } from '@/database/sync';
import { useEventsForRange } from '@/database/useEvents';
import { useAccountStore } from '@/stores/accountStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useActiveAccount, useVisibleAccounts } from '@/hooks/useAccounts';
import { useMultiCalendars } from '@/hooks/useCalendars';
import { useIsOnline } from '@/services/shared/network';
import { normalizeEvents } from '@/utils/normalizeEvent';
import { calendarKey, calendarKeyOf, hasCalendarFlag } from '@/utils/calendars';
import { monthRange } from '../utils/range';
import { AGENDA_FUTURE_DAYS, AGENDA_PAST_DAYS } from '../utils/agendaSections';
import type { CalendarEvent } from '@/types';

const RETRY_DELAYS_MS = [15000, 30000, 60000];

export function useCalendarData(date: Date, agendaEnabled = false) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const hiddenCalendarIds = useCalendarStore((s) => s.hiddenCalendarIds);
  const showCompletedTasks = useCalendarStore((s) => s.showCompletedTasks);
  const activeAccount = useActiveAccount(activeAccountId);
  const visibleAccounts = useVisibleAccounts();
  const online = useIsOnline();

  const { data: calendars = [], isFetching: calsFetching } = useMultiCalendars(visibleAccounts);
  const visibleIds = useMemo(() => visibleAccounts.map((a) => a.id), [visibleAccounts]);
  const visibleIdsKey = visibleIds.join(',');

  const year = dayjs(date).year();
  const month = dayjs(date).month();
  const { start, end } = useMemo(() => monthRange(date), [year, month]);

  const dbEvents = useEventsForRange(visibleIds, start, end);
  const agendaRange = useMemo(() => ({
    start: dayjs().subtract(AGENDA_PAST_DAYS, 'day').startOf('day').toDate(),
    end: dayjs().add(AGENDA_FUTURE_DAYS, 'day').endOf('day').toDate(),
  }), []);
  const agendaDbEvents = useEventsForRange(
    agendaEnabled ? visibleIds : [], agendaRange.start, agendaRange.end,
  );

  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const windowKey = `${visibleIdsKey}|${start.getTime()}|${end.getTime()}`;
  const windowKeyRef = useRef(windowKey);
  if (windowKeyRef.current !== windowKey) {
    windowKeyRef.current = windowKey;
    attemptsRef.current = 0;
  }

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    const delay = RETRY_DELAYS_MS[attemptsRef.current];
    if (delay === undefined) return;
    attemptsRef.current += 1;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => setRetryNonce((n) => n + 1), delay);
  }, []);

  const retrySync = useCallback(() => {
    attemptsRef.current = 0;
    clearRetryTimer();
    setRetryNonce((n) => n + 1);
  }, [clearRetryTimer]);

  const prevOnlineRef = useRef(online);
  useEffect(() => {
    const was = prevOnlineRef.current;
    prevOnlineRef.current = online;
    if (online && !was) setRetryNonce((n) => n + 1);
  }, [online]);

  useEffect(() => {
    if (visibleAccounts.length === 0 || calendars.length === 0) return;
    const allowed = new Set(visibleAccounts.map((a) => a.id));
    if (calendars.some((c) => !allowed.has(c.accountId))) {
      if (__DEV__) {
        console.warn('[useCalendarData] stale calendars for account set, skipping sync', visibleIdsKey);
      }
      return;
    }
    let active = true;
    setSyncing(true);
    (async () => {
      try {
        // Per-account isolation: one unreachable server must not block the others.
        const results = await Promise.allSettled(
          visibleAccounts.map((account) =>
            syncVisibleRange(
              account,
              calendars.filter((c) => c.accountId === account.id),
              start,
              end,
            ),
          ),
        );
        if (!active) return;
        const failedCount = results.reduce(
          (sum, r) => sum + (r.status === 'rejected' ? 1 : (r.value?.failedCount ?? 0)),
          0,
        );
        setSyncFailed(failedCount > 0);
        if (failedCount > 0) scheduleRetry();
        else {
          attemptsRef.current = 0;
          clearRetryTimer();
        }
      } finally {
        if (active) setSyncing(false);
      }
    })();
    return () => {
      active = false;
      setSyncing(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIdsKey, calendars, start.getTime(), end.getTime(), retryNonce]);

  const prepare = useMemo(() => {
    const nonEditableCalendarIds = new Set(
      calendars.filter((c) => c.isReadOnly || c.isSubscribed).map(calendarKeyOf),
    );
    return (events: CalendarEvent[]) => normalizeEvents(
      events.filter(
        (e) =>
          !hasCalendarFlag(hiddenCalendarIds, e.accountId, e.calendarId) &&
          (showCompletedTasks || !e.isTask || !e.taskCompleted),
      ),
    ).map((e) =>
      nonEditableCalendarIds.has(calendarKey(e.accountId, e.calendarId)) ? { ...e, readOnly: true } : e,
    );
  }, [hiddenCalendarIds, showCompletedTasks, calendars]);
  const allEvents = useMemo(() => prepare(dbEvents), [prepare, dbEvents]);
  const agendaEvents = useMemo(() => prepare(agendaDbEvents), [prepare, agendaDbEvents]);

  const hadEventsRef = useRef(false);
  useEffect(() => {
    if (allEvents.length > 0) hadEventsRef.current = true;
  }, [allEvents]);
  useEffect(() => {
    hadEventsRef.current = false;
  }, [visibleIdsKey]);

  const showFullOverlay = !hadEventsRef.current && syncing && allEvents.length === 0;
  const showSmallLoader = (syncing || calsFetching) && !showFullOverlay;

  return { activeAccount, visibleAccounts, calendars, allEvents, agendaEvents, showFullOverlay, showSmallLoader, syncFailed, retrySync };
}
