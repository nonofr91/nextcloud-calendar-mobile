import { useEffect, useRef, useState } from 'react';

import { syncCalendars } from '@/database/sync';
import { useCalendarsFromDb } from '@/database/useCalendars';
import type { Account, CalendarMeta } from '@/types';

const LIVE_POLL_MS = 30000;

export function useCalendars(account: Account | null): { data: CalendarMeta[]; isFetching: boolean } {
  const data = useCalendarsFromDb(account ? [account.id] : []);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (!account) return;
    let active = true;

    const run = (withSpinner: boolean) => {
      if (withSpinner) setIsFetching(true);
      syncCalendars(account)
        .catch((e) => {
          console.warn('[useCalendars] syncCalendars failed:', String(e));
        })
        .finally(() => {
          if (active && withSpinner) setIsFetching(false);
        });
    };

    run(true);
    const poll = setInterval(() => run(false), LIVE_POLL_MS);

    return () => {
      active = false;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  return { data, isFetching };
}

/**
 * Merged calendars for several accounts (multi-account views). One interval
 * round-robins the accounts so each is still polled every LIVE_POLL_MS while
 * avoiding a burst of simultaneous requests.
 */
export function useMultiCalendars(accounts: readonly Account[]): { data: CalendarMeta[]; isFetching: boolean } {
  const idsKey = accounts.map((a) => a.id).join('\0');
  const data = useCalendarsFromDb(accounts.map((a) => a.id));
  const [isFetching, setIsFetching] = useState(false);
  // Sync keys on ids only — a live ref keeps polling the current account
  // objects when credentials are refreshed in place.
  const accountsRef = useRef(accounts);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  useEffect(() => {
    const ids = idsKey ? idsKey.split('\0') : [];
    if (ids.length === 0) return;
    let active = true;
    let cursor = 0;
    let pending = 0;

    const syncOne = (id: string, withSpinner: boolean) => {
      const account = accountsRef.current.find((a) => a.id === id);
      if (!account) return;
      if (withSpinner) {
        pending += 1;
        setIsFetching(true);
      }
      syncCalendars(account)
        .catch((e) => {
          console.warn('[useMultiCalendars] syncCalendars failed:', String(e));
        })
        .finally(() => {
          if (active && withSpinner) {
            pending -= 1;
            if (pending === 0) setIsFetching(false);
          }
        });
    };

    ids.forEach((id) => syncOne(id, true));
    const poll = setInterval(() => {
      syncOne(ids[cursor % ids.length], false);
      cursor += 1;
    }, Math.max(1000, Math.floor(LIVE_POLL_MS / ids.length)));

    return () => {
      active = false;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return { data, isFetching };
}
