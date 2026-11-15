import { isOrganizer } from '@/features/event/utils/organizer';
import type { Account } from '@/types';

const account: Account = {
  id: 'acc-1',
  displayName: 'Work',
  baseUrl: 'https://cloud.example.com',
  username: 'john',
  appPassword: 'xxxx',
  davUserId: 'john',
  email: 'john@example.com',
};

describe('isOrganizer', () => {
  it('matches the account email', () => {
    expect(isOrganizer({ organizerEmail: 'john@example.com' }, account)).toBe(true);
  });

  it('matches a mailto: organizer', () => {
    expect(isOrganizer({ organizerEmail: 'mailto:john@example.com' }, account)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isOrganizer({ organizerEmail: 'John@Example.COM' }, account)).toBe(true);
  });

  it('rejects a different organizer', () => {
    expect(isOrganizer({ organizerEmail: 'alice@example.com' }, account)).toBe(false);
  });

  it('treats a missing organizerEmail as not-organizer', () => {
    expect(isOrganizer({ organizerEmail: undefined }, account)).toBe(false);
    expect(isOrganizer({}, account)).toBe(false);
  });

  it('falls back to username@hostname when the account has no email', () => {
    const noEmail: Account = { ...account, email: undefined };
    expect(isOrganizer({ organizerEmail: 'john@cloud.example.com' }, noEmail)).toBe(true);
    expect(isOrganizer({ organizerEmail: 'john@example.com' }, noEmail)).toBe(false);
  });
});
