import { useEffect, useRef } from 'react';
import { useAccounts } from '@/hooks/useAccounts';
import { prefetchContacts } from '@/services/nextcloud/contactCache';

// Attendee pickers can now target any visible account — warm every cache.
export function useContactCache(): void {
  const accounts = useAccounts();
  const accountsKey = accounts.map((a) => a.id).join(',');
  // The effect keys on ids only — keep a live ref so a refreshed account list
  // (new appPassword, baseUrl) is used without waiting for an id change.
  const accountsRef = useRef(accounts);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  useEffect(() => {
    for (const account of accountsRef.current) {
      void prefetchContacts(account).catch((e) => {
        console.warn('[useContactCache] prefetch failed:', String(e));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey]);
}
