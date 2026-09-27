import type { CalendarEvent } from '@/types';
import { displayLocation, meetingProvider, stripUrls } from '@/features/widget/core/liveEvent';
import i18n from '@/utils/i18n';

const MAX_DESCRIPTION = 200;

export type AlertEvent = Pick<
  CalendarEvent,
  'summary' | 'description' | 'location' | 'dtstart' | 'allDay'
>;

function dayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function leadLabel(event: Pick<AlertEvent, 'dtstart' | 'allDay'>, at: Date): string {
  const minutes = Math.round((event.dtstart.getTime() - at.getTime()) / 60_000);

  if (!event.allDay && minutes < 1440) {
    if (minutes <= 0) return i18n.t('notifications.lead.now');
    if (minutes < 60) return i18n.t('notifications.lead.minutes', { value: minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0
      ? i18n.t('notifications.lead.hours', { value: hours })
      : i18n.t('notifications.lead.hoursMinutes', { value: hours, minutes: rest });
  }

  const days = dayDiff(at, event.dtstart);
  if (days <= 0) return i18n.t('notifications.lead.today');
  if (days === 1) return i18n.t('notifications.lead.tomorrow');
  return i18n.t('notifications.lead.days', { value: days });
}

function cleanDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const text = stripUrls(description)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (!text) return undefined;
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : text;
}

function videoConferenceLabel(provider: string): string {
  return i18n.t('widget.videoConference', { provider });
}

export function alertBody(event: AlertEvent, at: Date): string {
  const parts = [leadLabel(event, at)];

  const location = displayLocation(event.location);
  if (location) parts.push(location);

  const locationProvider = meetingProvider(event.location);
  const locationShowsVisio =
    !!locationProvider && location === videoConferenceLabel(locationProvider);
  const descriptionProvider = meetingProvider(event.description);
  if (descriptionProvider && !locationShowsVisio) {
    parts.push(videoConferenceLabel(descriptionProvider));
  }

  const description = cleanDescription(event.description);
  if (description) parts.push(description);

  return parts.join('\n');
}
