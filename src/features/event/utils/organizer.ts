import type { Account } from '@/types';

export function resolveOrganizer(account: Account): { organizerEmail: string; organizerName: string } {
  const organizerEmail = account.email
    || (account.username.includes('@')
      ? account.username
      : `${account.username}@${new URL(account.baseUrl).hostname}`);
  return { organizerEmail, organizerName: account.displayName };
}
