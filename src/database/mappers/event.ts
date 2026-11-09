import type { Attendee, CalendarEvent, EventStatus, EventTransp, EventAttachment } from '@/types';
import { dedupeAttendees } from '@/utils/attendees';
import { taskIsCompleted } from '@/utils/vtodo';

import Event from '../models/Event';

function parseAttendees(raw?: string): Attendee[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupeAttendees(parsed as Attendee[]) : [];
  } catch {
    return [];
  }
}

function parseAlarms(raw?: string, legacyMinutes?: number): number[] | undefined {
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((m): m is number => typeof m === 'number' && Number.isFinite(m));
      }
    } catch {
      // fall through to the legacy scalar column
    }
  }
  return legacyMinutes != null ? [legacyMinutes] : undefined;
}

function parseAttachments(raw?: string): EventAttachment[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as EventAttachment[]) : undefined;
  } catch {
    return undefined;
  }
}

export function mapEventToShared(event: Event): CalendarEvent {
  return {
    uid: event.uid,
    href: event.href,
    calendarId: event.calendarId,
    accountId: event.accountId,
    summary: event.summary,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    dtstart: new Date(event.start),
    dtend: new Date(event.end),
    allDay: !!event.allDay,
    color: event.color,
    attendees: parseAttendees(event.attendees),
    organizerEmail: event.organizerEmail ?? undefined,
    talkUrl: event.talkUrl ?? undefined,
    isRecurring: !!event.isRecurring,
    rrule: event.rrule ?? undefined,
    recurrenceId: event.recurrenceId != null ? new Date(event.recurrenceId) : undefined,
    alarms: parseAlarms(event.alarms ?? undefined, event.alarmMinutes ?? undefined),
    isTask: !!event.isTask,
    transp: event.transp as EventTransp | undefined,
    status: event.status as EventStatus | undefined,
    timezone: event.timezone ?? undefined,
    taskStatus: event.taskStatus ?? undefined,
    taskCompletedAt: event.taskCompletedAt != null ? new Date(event.taskCompletedAt) : undefined,
    taskPercent: event.taskPercent ?? undefined,
    taskCompleted: taskIsCompleted(event.taskStatus, event.taskCompletedAt, event.taskPercent),
    attachments: parseAttachments(event.attachments ?? undefined),
  };
}
