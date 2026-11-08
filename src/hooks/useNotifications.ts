import { useEffect, useCallback, useRef } from 'react';

import { useAccounts, useVisibleAccounts } from '@/hooks/useAccounts';
import { useNotificationStore, withSeenFlag } from '@/stores/notificationStore';
import { fetchNotifications } from '@/services/nextcloud/notifications';

const REFRESH_INTERVAL_MS = 60_000;

// Polls every account's notification app and merges the lists — notification
// ids are per-server sequences, so each entry is stamped with its accountId.
export function useNotifications(): void {
  const accounts = useAccounts();
  const visibleAccounts = useVisibleAccounts();
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const accountsKey = accounts.map((a) => a.id).join(',');
  const visibleKey = visibleAccounts.map((a) => a.id).join(',');
  // Polling keys on ids — a live ref keeps fetching with the current account
  // objects when credentials are refreshed in place.
  const visibleRef = useRef(visibleAccounts);
  useEffect(() => { visibleRef.current = visibleAccounts; }, [visibleAccounts]);

  const refresh = useCallback(async () => {
    // Visible accounts drive the merged list — `null` already resolves to all
    // accounts while hydrating, so an empty subset is an explicit "show none".
    const targets = visibleRef.current;
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((account) => fetchNotifications(account)),
    );
    const merged = results.flatMap((r, i) =>
      r.status === 'fulfilled'
        ? r.value.map((n) => withSeenFlag(n, targets[i].id))
        : [],
    );
    if (merged.length > 0) console.log('[useNotifications] fetched', merged.length);
    if (results.some((r) => r.status === 'fulfilled')) setNotifications(merged);
    results.forEach((r) => {
      if (r.status === 'rejected') console.warn('[useNotifications] fetch failed:', r.reason);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey, visibleKey, setNotifications]);

  useEffect(() => {
    if (visibleRef.current.length === 0) return;

    void refresh();

    const interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey, refresh]);
}
