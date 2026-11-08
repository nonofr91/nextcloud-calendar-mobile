import { useMemo } from 'react';
import { useSyncExternalStore } from 'react';

import { loadAccounts } from '@/services/nextcloud/auth';
import { useAccountStore } from '@/stores/accountStore';
import type { Account } from '@/types';

let accounts: Account[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

// Keeps the persisted visible-account subset consistent with the connected
// list — a removed account must not keep occupying a slot in it.
function pruneVisibleIds(list: Account[]): void {
  const { visibleAccountIds, setVisibleAccountIds } = useAccountStore.getState();
  if (!visibleAccountIds) return;
  const ids = new Set(list.map((a) => a.id));
  const next = visibleAccountIds.filter((id) => ids.has(id));
  if (next.length === list.length) setVisibleAccountIds(null);
  else if (next.length !== visibleAccountIds.length) setVisibleAccountIds(next);
}

export function setAccounts(list: Account[]): void {
  accounts = list;
  pruneVisibleIds(list);
  emit();
}

export async function refreshAccounts(): Promise<Account[]> {
  accounts = await loadAccounts();
  setAccounts(accounts);
  return accounts;
}

export function getAccounts(): Account[] {
  return accounts;
}

export function useAccounts(): Account[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => accounts,
    () => accounts,
  );
}

export function useActiveAccount(activeAccountId: string | null): Account | null {
  const list = useAccounts();
  return list.find((a) => a.id === activeAccountId) ?? null;
}

export function getVisibleAccounts(): Account[] {
  const visibleIds = useAccountStore.getState().visibleAccountIds;
  const list = getAccounts();
  return visibleIds ? list.filter((a) => visibleIds.includes(a.id)) : list;
}

export function useVisibleAccounts(): Account[] {
  const list = useAccounts();
  const visibleIds = useAccountStore((s) => s.visibleAccountIds);
  return useMemo(
    () => (visibleIds ? list.filter((a) => visibleIds.includes(a.id)) : list),
    [list, visibleIds],
  );
}

export function useVisibleAccountIds(): string[] {
  const accounts = useVisibleAccounts();
  return useMemo(() => accounts.map((a) => a.id), [accounts]);
}

/** The account an event belongs to — writes must target it, never the active one. */
export function accountForEvent(accounts: readonly Account[], accountId: string | undefined): Account | null {
  return accounts.find((a) => a.id === accountId) ?? null;
}
