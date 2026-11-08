import { byServerOrder, calendarGroup, calendarKey, calendarKeyOf, hasCalendarFlag } from '../../src/utils/calendars';
import { useAccountStore } from '../../src/stores/accountStore';
import type { CalendarMeta } from '../../src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const cal = (id: string, extra: Partial<CalendarMeta> = {}): CalendarMeta => ({
  id,
  accountId: 'acc-1',
  displayName: id,
  color: '#fff',
  ctag: '1',
  url: `https://cloud.example.com/remote.php/dav/calendars/john/${id}/`,
  slug: id,
  ...extra,
});

describe('calendarGroup', () => {
  it('splits calendars like the Nextcloud web sidebar', () => {
    expect(calendarGroup(cal('personal'))).toBe('personal');
    expect(calendarGroup(cal('holidays', { isSubscribed: true }))).toBe('personal');
    expect(calendarGroup(cal('team_shared_by_jane', { isShared: true }))).toBe('shared');
    expect(calendarGroup(cal('app-generated--deck--board-1', { supportsEvents: false }))).toBe('deck');
    expect(calendarGroup(cal('todo', { supportsEvents: false }))).toBe('tasks');
  });
});

describe('byServerOrder', () => {
  it('sorts by the Nextcloud calendar-order', () => {
    const sorted = [cal('c', { order: 2 }), cal('a', { order: 0 }), cal('b', { order: 1 })].sort(byServerOrder);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the existing order for ties and missing values', () => {
    const sorted = [cal('x', { order: 1 }), cal('y'), cal('z', { order: 0 }), cal('w', { order: 1 })].sort(byServerOrder);
    expect(sorted.map((c) => c.id)).toEqual(['y', 'z', 'x', 'w']);
  });

  it('puts groups first, then the order inside each group', () => {
    const sorted = [
      cal('todo', { supportsEvents: false, order: 0 }),
      cal('shared', { isShared: true, order: 0 }),
      cal('mine', { order: 5 }),
    ].sort(byServerOrder);
    expect(sorted.map((c) => c.id)).toEqual(['mine', 'shared', 'todo']);
  });
});

describe('calendarKey', () => {
  it('builds a composite account-scoped key', () => {
    expect(calendarKey('acc-1', 'personal')).toBe('acc-1|personal');
    expect(calendarKeyOf(cal('personal', { accountId: 'acc-2' }))).toBe('acc-2|personal');
  });

  it('disambiguates identical remote ids across accounts', () => {
    expect(calendarKey('acc-1', 'personal')).not.toBe(calendarKey('acc-2', 'personal'));
  });
});

describe('hasCalendarFlag', () => {
  beforeEach(() => {
    useAccountStore.setState({ activeAccountId: 'acc-1' });
  });

  it('matches the composite key for the owning account only', () => {
    const list = ['acc-1|personal'];
    expect(hasCalendarFlag(list, 'acc-1', 'personal')).toBe(true);
    expect(hasCalendarFlag(list, 'acc-2', 'personal')).toBe(false);
  });

  it('works with a Set of keys', () => {
    const set = new Set(['acc-2|tasks']);
    expect(hasCalendarFlag(set, 'acc-2', 'tasks')).toBe(true);
    expect(hasCalendarFlag(set, 'acc-1', 'tasks')).toBe(false);
  });

  it('scopes pre-multi-account bare ids to the active account only', () => {
    const list = ['personal'];
    expect(hasCalendarFlag(list, 'acc-1', 'personal')).toBe(true);
    expect(hasCalendarFlag(list, 'acc-2', 'personal')).toBe(false);
  });

  it('ignores a bare id when no account is active', () => {
    useAccountStore.setState({ activeAccountId: null });
    expect(hasCalendarFlag(['personal'], 'acc-1', 'personal')).toBe(false);
  });
});
