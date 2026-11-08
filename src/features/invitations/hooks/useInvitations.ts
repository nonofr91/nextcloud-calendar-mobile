import { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';

import type { Account, CalendarInvitation } from '@/types';

const POLL_MS = 60_000;

// Fetches scheduling inboxes of every given account and merges them — each
// invitation already carries its accountId, so responses can be routed back.
export function useInvitations(accounts: readonly Account[]) {
  const [data, setData] = useState<CalendarInvitation[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const accountsKey = accounts.map((a) => a.id).join(',');
  // refresh keys on ids only — a live ref keeps polling the current account
  // objects when credentials are refreshed in place.
  const accountsRef = useRef(accounts);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  const refresh = useCallback(async () => {
    const current = accountsRef.current;
    if (current.length === 0) {
      setData([]);
      return;
    }
    setIsFetching(true);
    setError(null);
    try {
      const { fetchInvitations } = await import('@/services/nextcloud/invitations');
      const results = await Promise.allSettled(
        current.map((account) => fetchInvitations(account)),
      );
      const merged = results.flatMap((r, i) => {
        if (r.status === 'rejected') {
          console.warn('[useInvitations] fetch failed for account', current[i]?.id, String(r.reason));
          return [];
        }
        return r.value;
      });
      merged.sort((a, b) => a.dtstart.getTime() - b.dtstart.getTime());
      setData(merged);
      await Notifications.setBadgeCountAsync(merged.length);
      if (results.every((r) => r.status === 'rejected')) {
        setError(new Error('all accounts failed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      console.warn('[useInvitations] fetch failed:', String(e));
    } finally {
      setIsFetching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey]);

  useEffect(() => {
    if (accountsRef.current.length === 0) return;
    refresh();
    const poll = setInterval(() => refresh(), POLL_MS);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey, refresh]);

  return { data, isFetching, error, refresh };
}
