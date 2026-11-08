import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { legacyBackedStorage } from '@/stores/legacyStorage';
import type { ServerCapabilities } from '@/types';

interface AccountState {
  activeAccountId: string | null;
  // null = every connected account is shown (default, and the pre-multi-account
  // behavior for single-account users). A subset limits reads/sync to those ids.
  visibleAccountIds: string[] | null;
  capabilities: ServerCapabilities;
  capabilitiesByAccount: Record<string, ServerCapabilities>;
  setActiveAccountId: (id: string | null) => void;
  setVisibleAccountIds: (ids: string[] | null) => void;
  toggleAccountVisibility: (accountId: string, allIds: string[]) => void;
  setCapabilities: (caps: ServerCapabilities) => void;
  setCapabilitiesFor: (accountId: string, caps: ServerCapabilities) => void;
}

const UNPROBED_CAPABILITIES: ServerCapabilities = { talkEnabled: false, calendarApp: 'unknown' };

/** Capabilities of a given account — the active account falls back to its
 * global (legacy) entry; a non-active, never-probed account must not inherit
 * another server's capabilities. */
export function capabilitiesForAccount(
  state: Pick<AccountState, 'capabilities' | 'capabilitiesByAccount' | 'activeAccountId'>,
  accountId: string | null | undefined,
): ServerCapabilities {
  if (accountId && state.capabilitiesByAccount[accountId]) {
    return state.capabilitiesByAccount[accountId];
  }
  if (accountId && accountId === state.activeAccountId) return state.capabilities;
  return UNPROBED_CAPABILITIES;
}

/** True while at least one of the given accounts reports a calendar app. */
export function anyCalendarConfigured(
  state: Pick<AccountState, 'capabilities' | 'capabilitiesByAccount' | 'activeAccountId'>,
  accountIds: readonly string[],
): boolean {
  if (accountIds.length === 0) return state.capabilities.calendarApp !== 'unconfigured';
  return accountIds.some(
    (id) => capabilitiesForAccount(state, id).calendarApp !== 'unconfigured',
  );
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      activeAccountId: null,
      visibleAccountIds: null,
      capabilities: { talkEnabled: false, calendarApp: 'unknown' },
      capabilitiesByAccount: {},
      setActiveAccountId: (id) => set({ activeAccountId: id }),
      setVisibleAccountIds: (ids) => set({ visibleAccountIds: ids }),
      toggleAccountVisibility: (accountId, allIds) =>
        set((state) => {
          const current = state.visibleAccountIds ?? allIds;
          const next = current.includes(accountId)
            ? current.filter((id) => id !== accountId)
            : [...allIds.filter((id) => current.includes(id) || id === accountId)];
          // Collapse back to null when every account is visible again.
          return { visibleAccountIds: next.length === allIds.length ? null : next };
        }),
      setCapabilities: (caps) => set({ capabilities: caps }),
      setCapabilitiesFor: (accountId, caps) =>
        set((state) => ({
          capabilitiesByAccount: { ...state.capabilitiesByAccount, [accountId]: caps },
        })),
    }),
    {
      name: 'account-store',
      storage: createJSONStorage(() => legacyBackedStorage(['activeAccountId'])),
      partialize: (state) => ({
        activeAccountId: state.activeAccountId,
        visibleAccountIds: state.visibleAccountIds,
        capabilities: state.capabilities,
        capabilitiesByAccount: state.capabilitiesByAccount,
      }),
    }
  )
);
