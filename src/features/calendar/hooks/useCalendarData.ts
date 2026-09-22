import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';

import { syncEvents } from '@/database/sync';
import { useEventsForRange } from '@/database/useEvents';
import { useAccountStore } from '@/stores/accountStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useActiveAccount } from '@/hooks/useAccounts';
import { useCalendars } from '@/hooks/useCalendars';
import { useIsOnline } from '@/services/shared/network';
import { normalizeEvents } from '@/utils/normalizeEvent';
import { monthRange, monthRangeAt } from '../utils/range';

const RETRY_DELAYS_MS = [15000, 30000, 60000];

export function useCalendarData(date: Date) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const hiddenCalendarIds = useCalendarStore((s) => s.hiddenCalendarIds);
  const activeAccount = useActiveAccount(activeAccountId);
  const online = useIsOnline();

  const { data: calendars = [], isFetching: calsFetching } = useCalendars(activeAccount);

  const year = dayjs(date).year();
  const month = dayjs(date).month();
  const { start, end } = useMemo(() => monthRange(date), [year, month]);

  const dbEvents = useEventsForRange(activeAccountId ?? '', start, end);

  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const windowKey = `${activeAccount?.id ?? ''}|${start.getTime()}|${end.getTime()}`;
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
    if (!activeAccount || calendars.length === 0) return;
    if (calendars.some((c) => c.accountId !== activeAccount.id)) {
      if (__DEV__) {
        console.warn('[useCalendarData] stale calendars for account, skipping sync', activeAccount.id);
      }
      return;
    }
    let active = true;
    setSyncing(true);
    (async () => {
      try {
        const { failedCount } = await syncEvents(activeAccount, calendars, start, end);
        if (active) {
          setSyncFailed(failedCount > 0);
          if (failedCount > 0) scheduleRetry();
          else {
            attemptsRef.current = 0;
            clearRetryTimer();
          }
        }
      } catch (error) {
        console.warn('[useCalendarData] syncEvents failed:', String(error));
        if (active) {
          setSyncFailed(true);
          scheduleRetry();
        }
      } finally {
        if (active) setSyncing(false);
      }
      const prev = monthRangeAt(date, -1);
      const next = monthRangeAt(date, 1);
      void syncEvents(activeAccount, calendars, prev.start, prev.end, false).catch((e) => {
        console.warn('[useCalendarData] prev syncEvents failed:', String(e));
      });
      void syncEvents(activeAccount, calendars, next.start, next.end, false).catch((e) => {
        console.warn('[useCalendarData] next syncEvents failed:', String(e));
      });
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id, calendars, start.getTime(), end.getTime(), retryNonce]);

  const allEvents = useMemo(() => {
    const nonEditableCalendarIds = new Set(
      calendars.filter((c) => c.isReadOnly || c.isSubscribed).map((c) => c.id),
    );
    return normalizeEvents(
      dbEvents.filter((e) => !hiddenCalendarIds.includes(e.calendarId)),
    ).map((e) =>
      nonEditableCalendarIds.has(e.calendarId) ? { ...e, readOnly: true } : e,
    );
  }, [dbEvents, hiddenCalendarIds, calendars]);

  const hadEventsRef = useRef(false);
  useEffect(() => {
    if (allEvents.length > 0) hadEventsRef.current = true;
  }, [allEvents]);
  useEffect(() => {
    hadEventsRef.current = false;
  }, [activeAccountId]);

  const showFullOverlay = !hadEventsRef.current && syncing && allEvents.length === 0;
  const showSmallLoader = (syncing || calsFetching) && !showFullOverlay;

  return { activeAccount, calendars, allEvents, showFullOverlay, showSmallLoader, syncFailed, retrySync };
}
