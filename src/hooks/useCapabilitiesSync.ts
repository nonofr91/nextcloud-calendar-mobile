import { useEffect, useRef } from 'react';

import { useAccountStore } from '@/stores/accountStore';
import { useAccounts } from '@/hooks/useAccounts';
import { fetchCapabilities } from '@/services/nextcloud/nextcloud';

// Refreshes capabilities for every connected account — calendarApp detection
// (used by the calendar screen and the widget) is per-server.
export function useCapabilitiesSync(): void {
  const accounts = useAccounts();
  const setCapabilities = useAccountStore((s) => s.setCapabilities);
  const setCapabilitiesFor = useAccountStore((s) => s.setCapabilitiesFor);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const launchHandled = useRef(false);
  const accountsKey = accounts.map((a) => a.id).join(',');
  // Probing keys on ids only — a live ref keeps fetching with the current
  // account objects when credentials are refreshed in place.
  const accountsRef = useRef(accounts);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  useEffect(() => {
    const current = accountsRef.current;
    if (current.length === 0) return;
    if (!launchHandled.current) {
      launchHandled.current = true;
      return;
    }
    let active = true;
    for (const account of current) {
      fetchCapabilities(account)
        .then((caps) => {
          if (!active) return;
          setCapabilitiesFor(account.id, caps);
          // `capabilities` stays the active account's view for legacy readers.
          if (account.id === useAccountStore.getState().activeAccountId) {
            setCapabilities(caps);
          }
        })
        .catch(() => undefined);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey, setCapabilities, setCapabilitiesFor]);

  // The legacy `capabilities` mirror follows the active account — switching
  // accounts re-mirrors from the probed per-account map without a refetch.
  useEffect(() => {
    if (!activeAccountId) return;
    const cached = useAccountStore.getState().capabilitiesByAccount[activeAccountId];
    if (cached) setCapabilities(cached);
  }, [activeAccountId, setCapabilities]);
}
