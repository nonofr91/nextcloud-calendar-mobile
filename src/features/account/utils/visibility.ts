import { setActiveAccountId } from '@/services/nextcloud/auth';
import { useAccountStore } from '@/stores/accountStore';

/**
 * Toggles an account's presence in the merged view. When the hidden account
 * was the default, the next visible account is promoted so writes keep a
 * sane target.
 */
export async function toggleAccountVisibilityAndPromote(
  accountId: string,
  allIds: string[],
): Promise<void> {
  const wasDefault = useAccountStore.getState().activeAccountId === accountId;
  useAccountStore.getState().toggleAccountVisibility(accountId, allIds);
  const next = useAccountStore.getState().visibleAccountIds ?? allIds;
  if (wasDefault && !next.includes(accountId) && next.length > 0) {
    await setActiveAccountId(next[0]);
    useAccountStore.getState().setActiveAccountId(next[0]);
  }
}
