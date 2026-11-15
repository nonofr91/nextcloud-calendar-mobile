import type { Account, CalendarEvent } from '@/types';

export function resolveOrganizer(account: Account): { organizerEmail: string; organizerName: string } {
  const organizerEmail = account.email
    || (account.username.includes('@')
      ? account.username
      : `${account.username}@${new URL(account.baseUrl).hostname}`);
  return { organizerEmail, organizerName: account.displayName };
}

/**
 * True when the account is the event's organizer. `organizerEmail` may be
 * missing on foreign/legacy events → not organizer (never offer suppression).
 */
export function isOrganizer(event: Pick<CalendarEvent, 'organizerEmail'>, account: Account): boolean {
  const eventEmail = event.organizerEmail?.replace(/^mailto:/i, '').trim().toLowerCase();
  if (!eventEmail) return false;
  return eventEmail === resolveOrganizer(account).organizerEmail.toLowerCase();
}
