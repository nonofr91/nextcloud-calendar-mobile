import { useAccountStore, capabilitiesForAccount, anyCalendarConfigured } from '../../src/stores/accountStore';
import { setAccounts } from '../../src/hooks/useAccounts';
import type { Account } from '../../src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const account = (id: string): Account =>
  ({ id, displayName: id, baseUrl: `https://${id}.test`, username: 'u', appPassword: 'p' }) as Account;

beforeEach(() => {
  useAccountStore.setState({
    activeAccountId: null,
    visibleAccountIds: null,
    capabilities: { talkEnabled: false, calendarApp: 'unknown' },
    capabilitiesByAccount: {},
  });
  setAccounts([]);
});

describe('accountStore', () => {

  it('sets active account id', () => {
    useAccountStore.getState().setActiveAccountId('acc-1');
    expect(useAccountStore.getState().activeAccountId).toBe('acc-1');
  });

  it('clears active account id', () => {
    useAccountStore.getState().setActiveAccountId('acc-1');
    useAccountStore.getState().setActiveAccountId(null);
    expect(useAccountStore.getState().activeAccountId).toBeNull();
  });

  it('sets capabilities', () => {
    useAccountStore.getState().setCapabilities({ talkEnabled: true, calendarApp: 'available' });
    expect(useAccountStore.getState().capabilities.talkEnabled).toBe(true);
  });
});

describe('toggleAccountVisibility', () => {
  const allIds = ['a', 'b', 'c'];
  const toggle = (id: string) => useAccountStore.getState().toggleAccountVisibility(id, allIds);

  it('null means all visible; first toggle narrows to the rest', () => {
    toggle('a');
    expect(useAccountStore.getState().visibleAccountIds).toEqual(['b', 'c']);
  });

  it('re-showing every account collapses back to null', () => {
    toggle('a');
    toggle('a');
    expect(useAccountStore.getState().visibleAccountIds).toBeNull();
  });

  it('a partially hidden subset can hide down to zero', () => {
    toggle('a');
    toggle('b');
    toggle('c');
    expect(useAccountStore.getState().visibleAccountIds).toEqual([]);
  });
});

describe('visibleAccountIds pruning', () => {
  it('drops removed accounts from the persisted subset', () => {
    setAccounts([account('a'), account('b'), account('c')]);
    useAccountStore.getState().setVisibleAccountIds(['a', 'c']);
    setAccounts([account('a'), account('b')]);
    expect(useAccountStore.getState().visibleAccountIds).toEqual(['a']);
  });

  it('collapses to null when the subset now covers every account', () => {
    setAccounts([account('a'), account('b')]);
    useAccountStore.getState().setVisibleAccountIds(['a', 'b']);
    setAccounts([account('a')]);
    expect(useAccountStore.getState().visibleAccountIds).toBeNull();
  });
});

describe('capabilitiesForAccount', () => {
  it('returns the probed entry for a non-active account', () => {
    useAccountStore.setState({
      capabilitiesByAccount: { b: { talkEnabled: true, calendarApp: 'available' } },
      activeAccountId: 'a',
    });
    expect(capabilitiesForAccount(useAccountStore.getState(), 'b').talkEnabled).toBe(true);
  });

  it('falls back to the legacy mirror for the active account', () => {
    useAccountStore.setState({
      activeAccountId: 'a',
      capabilities: { talkEnabled: true, calendarApp: 'available' },
    });
    expect(capabilitiesForAccount(useAccountStore.getState(), 'a').calendarApp).toBe('available');
  });

  it('never leaks the active account capabilities to an unprobed account', () => {
    useAccountStore.setState({
      activeAccountId: 'a',
      capabilities: { talkEnabled: true, calendarApp: 'available' },
    });
    const caps = capabilitiesForAccount(useAccountStore.getState(), 'b');
    expect(caps.talkEnabled).toBe(false);
    expect(caps.calendarApp).toBe('unknown');
  });
});

describe('anyCalendarConfigured', () => {
  it('empty subset reads the legacy mirror', () => {
    useAccountStore.setState({ capabilities: { talkEnabled: false, calendarApp: 'available' } });
    expect(anyCalendarConfigured(useAccountStore.getState(), [])).toBe(true);
    useAccountStore.setState({ capabilities: { talkEnabled: false, calendarApp: 'unconfigured' } });
    expect(anyCalendarConfigured(useAccountStore.getState(), [])).toBe(false);
  });

  it('a subset is configured when any of its accounts probed available', () => {
    useAccountStore.setState({
      capabilitiesByAccount: {
        a: { talkEnabled: false, calendarApp: 'unconfigured' },
        b: { talkEnabled: false, calendarApp: 'available' },
      },
    });
    expect(anyCalendarConfigured(useAccountStore.getState(), ['a', 'b'])).toBe(true);
    expect(anyCalendarConfigured(useAccountStore.getState(), ['a'])).toBe(false);
  });
});
