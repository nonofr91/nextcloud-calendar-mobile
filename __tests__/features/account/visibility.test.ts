import { toggleAccountVisibilityAndPromote } from '@/features/account/utils/visibility';
import { useAccountStore } from '@/stores/accountStore';
import { storage } from '@/storage';

const allIds = ['a', 'b', 'c'];

beforeEach(() => {
  useAccountStore.setState({ activeAccountId: 'a', visibleAccountIds: null });
  storage.clearAll();
});

describe('toggleAccountVisibilityAndPromote', () => {
  it('hides a non-default account without touching the default', async () => {
    await toggleAccountVisibilityAndPromote('b', allIds);
    const s = useAccountStore.getState();
    expect(s.visibleAccountIds).toEqual(['a', 'c']);
    expect(s.activeAccountId).toBe('a');
    expect(storage.getString('active_account_id')).toBeUndefined();
  });

  it('promotes the next visible account when the default gets hidden', async () => {
    await toggleAccountVisibilityAndPromote('a', allIds);
    const s = useAccountStore.getState();
    expect(s.visibleAccountIds).toEqual(['b', 'c']);
    expect(s.activeAccountId).toBe('b');
    expect(storage.getString('active_account_id')).toBe('b');
  });

  it('keeps the default when hiding it leaves nothing visible', async () => {
    useAccountStore.setState({ visibleAccountIds: ['a'] });
    await toggleAccountVisibilityAndPromote('a', allIds);
    const s = useAccountStore.getState();
    expect(s.visibleAccountIds).toEqual([]);
    expect(s.activeAccountId).toBe('a');
    expect(storage.getString('active_account_id')).toBeUndefined();
  });
});
