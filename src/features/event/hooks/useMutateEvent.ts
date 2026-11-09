import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as Crypto from 'expo-crypto';
import dayjs from 'dayjs';

import { putEvent, updateEvent, deleteEvent, moveEvent, fetchEventIcs, fetchEventIcsWithEtag, buildEventHref } from '@/services/nextcloud/caldav';
import { deleteRemoteFile, ownDavPath, uploadAttachmentFile, type UploadedFile } from '@/services/nextcloud/files';
import { createPublicLinkShare } from '@/services/nextcloud/shares';
import { createTalkRoom } from '@/services/nextcloud/talk';
import { describeMutationError } from '@/services/shared/errors';
import { enqueue, isNetworkFailure } from '@/services/pendingMutations';
import { buildAttachLine, injectAttachLine, removeAttachLine } from '@/features/event/utils/attachmentWrite';
import { buildIcs, buildAllDayIcs, buildExceptionIcs, cloneEventIcs, injectExdate, truncateRruleUntil, shiftIcsDates, upsertOverride } from '@/utils/ics';
import { parseIcsObjects, extractDtstartTzid, extractSequence, extractDtstartDtend, extractExtraVeventLines, dropLocationBoundLines, extractVtimezoneLines } from '@/utils/caldav-parse';
import { isValidTimeZone, resolveAccountTimezone } from '@/utils/timezone';
import { allDayAlarmMinutes } from '@/features/notifications/alerts';
import { useSettingsStore } from '@/stores/settingsStore';
import i18n from '@/utils/i18n';
import {
  findIdenticalEvent,
  insertEvents,
  patchByUid,
  removeWhere,
  restoreSeries,
  snapshotByBase,
  seriesBaseUid,
  shiftSeriesDates,
} from '@/database/eventWrites';
import { syncCalendarDelta } from '@/database/sync';
import { releasePending } from '@/database/pendingWrites';
import { eventKey } from '@/database/sync';
import { occurrenceSlot } from '@/features/event/occurrenceTarget';
import { calendarKeyOf } from '@/utils/calendars';
import type { Account, CalendarMeta, CalendarEvent, CreateEventInput, RecurrenceEditScope } from '@/types';

const TALK_URL_PATTERN = /\/call\//;

/**
 * Applies the attachment delta carried by a form submit to a built ICS:
 * strips `removedAttachments` lines, uploads `pendingAttachments` to Files and
 * injects their ATTACH lines. Upload failures never block the event save —
 * they are counted so the caller can warn once.
 */
async function applyAttachmentDelta(
  account: Account,
  ics: string,
  input: CreateEventInput,
): Promise<{ ics: string; failures: number; uploadedPaths: string[] }> {
  let out = ics;
  for (const att of input.removedAttachments ?? []) {
    out = removeAttachLine(out, att);
  }
  let failures = 0;
  // Events with attendees can opt into public `/s/<token>` links so
  // attendees can open the files — a private DAV URL is useless to them.
  const sharePublicly = !!input.shareAttachments;
  const publicUriFor = async (path: string, fallback: string): Promise<string> => {
    try {
      return (await createPublicLinkShare(account, path)).url;
    } catch (error) {
      failures++;
      console.warn('[attachments] public share failed, keeping private link', error);
      return fallback;
    }
  };
  // Files already on Nextcloud — the URI goes straight into the ICS.
  for (const att of input.remoteAttachments ?? []) {
    try {
      const path = sharePublicly && att.uri ? ownDavPath(account, att.uri) : null;
      const uri =
        path && att.uri ? await publicUriFor(path, att.uri) : att.uri;
      out = injectAttachLine(out, buildAttachLine({ ...att, uri }));
    } catch (error) {
      failures++;
      console.warn('[attachments] remote attach failed', att.uri, error);
    }
  }
  const uploadedPaths: string[] = [];
  for (const pending of input.pendingAttachments ?? []) {
    let up: UploadedFile | undefined;
    try {
      up = await uploadAttachmentFile(account, pending.name, pending.contentBase64, pending.mimeType);
      const uri = sharePublicly ? await publicUriFor(up.path, up.davUrl) : up.davUrl;
      out = injectAttachLine(
        out,
        buildAttachLine({
          uri,
          filename: up.filename,
          fmttype: pending.mimeType,
          size: pending.size,
          fileId: up.fileId,
        }),
      );
      // Tracked only once the file is actually referenced — the caller uses
      // this list to delete orphans when the enclosing PUT never happens.
      uploadedPaths.push(up.path);
    } catch (error) {
      failures++;
      console.warn('[attachments] pending upload failed', pending.name, error);
      // Uploaded but never injected — delete it now so nothing is orphaned.
      if (up) await deleteRemoteFile(account, up.path).catch(() => {});
    }
  }
  return { ics: out, failures, uploadedPaths };
}

/**
 * Deletes files that were uploaded but never made it into a stored ICS — call
 * only when the write that would have referenced them did not happen.
 */
async function cleanupUploaded(account: Account, paths: string[] | undefined): Promise<void> {
  for (const path of paths ?? []) {
    try {
      await deleteRemoteFile(account, path);
    } catch (error) {
      console.warn('[attachments] orphan upload cleanup failed', path, error);
    }
  }
}

function warnAttachmentFailures(failures: number) {
  if (failures > 0) Alert.alert(i18n.t('event.attachmentAddError'));
}

function hasAttachmentDelta(input: CreateEventInput): boolean {
  return !!(
    input.pendingAttachments?.length ||
    input.remoteAttachments?.length ||
    input.removedAttachments?.length
  );
}

/** Attachments live in the ICS blob — refresh local rows so the UI reflects them. */
async function resyncAfterAttachmentDelta(
  account: Account,
  calendar: CalendarMeta | undefined,
  input: CreateEventInput,
): Promise<void> {
  if (!calendar || !hasAttachmentDelta(input)) return;
  try {
    await syncCalendarDelta(account, calendar);
  } catch (error) {
    console.warn('[attachments] post-save resync failed', error);
  }
}

export function seriesDeltas(
  occurrence: { dtstart: Date; dtend: Date },
  nextStart: Date,
  nextEnd: Date,
): { deltaStart: number; deltaEnd: number } {
  return {
    deltaStart: nextStart.getTime() - occurrence.dtstart.getTime(),
    deltaEnd: nextEnd.getTime() - occurrence.dtend.getTime(),
  };
}

export function shiftedMasterInput(
  input: CreateEventInput,
  masterBounds: { dtstart: Date; dtend: Date },
  deltaStart: number,
  deltaEnd: number,
): CreateEventInput {
  return {
    ...input,
    dtstart: new Date(masterBounds.dtstart.getTime() + deltaStart),
    dtend: new Date(masterBounds.dtend.getTime() + deltaEnd),
  };
}

export type MutationResult = 'ok' | 'queued' | 'failed';

export function useAction<V, R = void>(run: (value: V) => Promise<R>): {
  mutate: (value: V) => void;
  mutateAsync: (value: V) => Promise<R>;
  isPending: boolean;
} {
  const [isPending, setIsPending] = useState(false);
  const mutateAsync = useCallback(
    async (value: V) => {
      setIsPending(true);
      try {
        return await run(value);
      } finally {
        setIsPending(false);
      }
    },
    [run],
  );
  const mutate = useCallback((value: V) => { void mutateAsync(value); }, [mutateAsync]);
  return { mutate, mutateAsync, isPending };
}

function resolveTimezone(account: Account): string {
  return resolveAccountTimezone(account);
}

/** A valid per-event override from the form, or undefined to fall back. */
function inputTimezone(input: CreateEventInput): string | undefined {
  return input.timezone && isValidTimeZone(input.timezone) ? input.timezone : undefined;
}

/**
 * The TZID of the series master, when Intl can resolve it. A non-IANA TZID
 * (e.g. "W. Europe Standard Time") can't produce wall stamps or offsets —
 * callers fall back rather than write an unresolvable zone.
 */
function masterTzid(ics: string): string | undefined {
  const tzid = extractDtstartTzid(ics);
  return tzid && isValidTimeZone(tzid) ? tzid : undefined;
}

function resolveCalendar(calendars: CalendarMeta[], calendarId: string, accountId?: string): CalendarMeta | undefined {
  if (accountId) {
    // Disambiguated pick — never fall back to another account's calendar.
    return (
      calendars.find((c) => c.accountId === accountId && c.id === calendarId) ??
      calendars.find((c) => c.accountId === accountId)
    );
  }
  // A composite picker key may arrive unpaired if the list shifted — match it
  // exactly before falling back to the bare remote id.
  return (
    calendars.find((c) => c.id === calendarId) ??
    calendars.find((c) => calendarKeyOf(c) === calendarId) ??
    calendars[0]
  );
}

function resolveAlarms(input: CreateEventInput): number[] | undefined {
  if (input.alarms !== undefined) return input.alarms;
  const { timedAlerts, allDayAlerts } = useSettingsStore.getState();
  const defaults = input.allDay ? allDayAlerts.map(allDayAlarmMinutes) : timedAlerts;
  return defaults.length ? defaults : undefined;
}

function buildIcsForInput(
  uid: string,
  input: CreateEventInput,
  location: string,
  description: string,
  timezone: string,
  sequence = 0,
  extraLines: string[] = [],
  calendarLines: string[] = [],
): string {
  const alarms = resolveAlarms(input);
  // A preserved raw RRULE (import path) must not survive next to a rule the
  // user explicitly set in the form — VEVENT allows a single RRULE.
  const extras = input.rrule
    ? extraLines.filter((line) => !/^RRULE:/i.test(line))
    : extraLines;
  return input.allDay
    ? buildAllDayIcs({
        uid, summary: input.summary, description, location, geo: input.geo,
        dtstart: input.dtstart, dtend: input.dtend,
        organizerEmail: input.organizerEmail, organizerName: input.organizerName,
        attendees: input.attendees, rrule: input.rrule, alarms,
        sequence, extraLines: extras, calendarLines,
      })
    : buildIcs({
        uid, summary: input.summary, description, location, geo: input.geo,
        dtstart: input.dtstart, dtend: input.dtend,
        organizerEmail: input.organizerEmail, organizerName: input.organizerName,
        attendees: input.attendees, timezone, rrule: input.rrule, alarms,
        sequence, extraLines: extras, calendarLines,
      });
}

function withServerOrganizer(input: CreateEventInput, event: CalendarEvent): CreateEventInput {
  return event.organizerEmail
    ? { ...input, organizerEmail: event.organizerEmail }
    : input;
}

async function resolveLocationAndDescription(
  account: Account,
  input: CreateEventInput,
): Promise<{ location: string; description: string }> {
  let location = input.location ?? '';
  let description = input.description ?? '';
  if (input.withTalkRoom) {
    const room = await createTalkRoom(account, input.summary, input.talkRoomType ?? 'private');
    location = room.url;
    description = description ? `${description}\n\nTalk: ${room.url}` : `Talk: ${room.url}`;
  }
  return { location, description };
}

function inputDates(input: CreateEventInput): { dtstart: Date; dtend: Date } {
  if (input.allDay) {
    return {
      dtstart: dayjs(input.dtstart).startOf('day').toDate(),
      dtend: dayjs(input.dtend).startOf('day').toDate(),
    };
  }
  return { dtstart: input.dtstart, dtend: input.dtend };
}

function eventFromInput(
  uid: string,
  input: CreateEventInput,
  calendar: CalendarMeta,
  account: Account,
  resolved?: { location: string; description: string },
  timezone?: string,
): CalendarEvent {
  const location = resolved?.location ?? input.location ?? '';
  const description = resolved?.description ?? input.description ?? '';
  const { dtstart, dtend } = inputDates(input);
  return {
    uid,
    href: buildEventHref(calendar, uid),
    calendarId: calendar.id,
    accountId: account.id,
    summary: input.summary,
    description: description || undefined,
    location: location || undefined,
    dtstart,
    dtend,
    allDay: input.allDay,
    color: calendar.color,
    attendees: input.attendees,
    organizerEmail: input.organizerEmail,
    talkUrl: TALK_URL_PATTERN.test(location) ? location : undefined,
    geo: input.geo,
    isRecurring: !!input.rrule,
    rrule: undefined,
    alarms: resolveAlarms(input),
    timezone: input.allDay ? undefined : timezone,
  };
}

function expandOccurrences(
  baseUid: string,
  input: CreateEventInput,
  calendar: CalendarMeta,
  account: Account,
  timezone: string,
  resolved?: { location: string; description: string },
): CalendarEvent[] {
  const location = resolved?.location ?? input.location ?? '';
  const description = resolved?.description ?? input.description ?? '';
  const ics = buildIcsForInput(baseUid, input, location, description, timezone, 0, input.extraLines);
  const rangeStart = dayjs(input.dtstart).subtract(1, 'month').toDate();
  const rangeEnd = dayjs(input.dtstart).add(3, 'month').toDate();
  return parseIcsObjects(
    [{ ics, href: buildEventHref(calendar, baseUid) }],
    { calendarId: calendar.id, accountId: account.id, color: calendar.color },
    rangeStart,
    rangeEnd,
  );
}

export function useCreateEvent(accounts: readonly Account[], calendars: CalendarMeta[]) {
  return useAction<CreateEventInput, MutationResult>(
    useCallback(async (input: CreateEventInput): Promise<MutationResult> => {
      const calendar = resolveCalendar(calendars, input.calendarId, input.calendarAccountId);
      // The target account is derived from the chosen calendar, never from
      // activeAccountId — writes must land on the calendar's owner server.
      const account = calendar ? accounts.find((a) => a.id === calendar.accountId) : undefined;
      if (!calendar || !account) return 'failed';

      const uid = input.uid ?? Crypto.randomUUID();
      const timezone = inputTimezone(input) ?? resolveTimezone(account);
      const optimistic = input.rrule
        ? expandOccurrences(uid, input, calendar, account, timezone)
        : [eventFromInput(uid, input, calendar, account, undefined, timezone)];

      let marked: string[] = [];
      let resolved: { location: string; description: string };
      let failures = 0;
      let uploadedPaths: string[] = [];
      let builtIcs = '';
      try {
        marked = await insertEvents(optimistic);

        // A retry after an ambiguous failure (request reached the server but the
        // response was lost) must not PUT a second resource: the first attempt's
        // optimistic rows are still here, so an identical event already exists.
        const { dtstart: probeStart, dtend: probeEnd } = inputDates(input);
        const dup = await findIdenticalEvent(
          account.id,
          calendar.id,
          { summary: input.summary, dtstart: probeStart, dtend: probeEnd, allDay: input.allDay },
          uid,
        );
        if (dup) {
          await removeWhere(account.id, (e) => seriesBaseUid(e.uid) === uid, { trackPending: false });
          return 'ok';
        }

        resolved = await resolveLocationAndDescription(account, input);
        builtIcs = buildIcsForInput(uid, input, resolved.location, resolved.description, timezone, 0, input.extraLines);
        await putEvent(account, calendar, uid, builtIcs);

        const real = input.rrule
          ? expandOccurrences(uid, input, calendar, account, timezone, resolved)
          : [eventFromInput(uid, input, calendar, account, resolved, timezone)];
        await insertEvents(real, { trackPending: false });
        builtIcs = buildIcsForInput(uid, input, resolved.location, resolved.description, timezone);
        const delta = await applyAttachmentDelta(account, builtIcs, input);
        failures = delta.failures;
        uploadedPaths = delta.uploadedPaths;
        builtIcs = delta.ics;
        await putEvent(account, calendar, uid, delta.ics);
      } catch (error) {
        if (isNetworkFailure(error) && builtIcs) {
          // Offline: keep the optimistic event and replay the PUT later.
          enqueue({ kind: 'create', accountId: account.id, calendar, uid, ics: builtIcs });
          Alert.alert(i18n.t('event.createQueued'), describeMutationError(error));
          return 'queued';
        }
        await removeWhere(account.id, (e) => seriesBaseUid(e.uid) === uid, { trackPending: false });
        // The event was never created — uploaded files would be orphaned.
        await cleanupUploaded(account, uploadedPaths);
        Alert.alert(i18n.t('event.errorCreateFailed'), describeMutationError(error));
        return 'failed';
      } finally {
        releasePending(marked);
      }

      // The PUT succeeded — the event exists on the server. Local writes are
      // best-effort: a failure must not report "create failed"; the delta sync
      // reconciles local state from the server.
      let resync = hasAttachmentDelta(input);
      const real = input.rrule
        ? expandOccurrences(uid, input, calendar, account, timezone, resolved)
        : [eventFromInput(uid, input, calendar, account, resolved, timezone)];
      try {
        await insertEvents(real, { trackPending: false });
      } catch (error) {
        console.warn('[useCreateEvent] post-PUT local write failed; forcing resync', error);
        resync = true;
      }
      warnAttachmentFailures(failures);
      if (resync) {
        try {
          await syncCalendarDelta(account, calendar);
        } catch (error) {
          console.warn('[useCreateEvent] post-save resync failed', error);
        }
      }
      return 'ok';
    }, [accounts, calendars]),
  );
}

export function useDuplicateEvent(account: Account, calendars: CalendarMeta[]) {
  const uidRef = useRef<string | undefined>(undefined);
  const action = useAction<{ event: CalendarEvent }>(
    useCallback(async ({ event }) => {
      const calendar = resolveCalendar(calendars, event.calendarId);
      if (!calendar) return;

      const newUid = Crypto.randomUUID();
      let cloneIcs: string;
      try {
        cloneIcs = cloneEventIcs(await fetchEventIcs(account, event.href), newUid);
      } catch (error) {
        Alert.alert(i18n.t('event.errorDuplicateFailed'), describeMutationError(error));
        return;
      }

      // Same optimistic window convention as create — occurrences outside it appear at
      // the next sync; a non-recurring copy parses range-free anyway.
      const optimistic = parseIcsObjects(
        [{ ics: cloneIcs, href: `${calendar.url}${newUid}.ics` }],
        { calendarId: calendar.id, accountId: account.id, color: calendar.color },
        dayjs(event.dtstart).subtract(1, 'month').toDate(),
        dayjs(event.dtstart).add(3, 'month').toDate(),
      );
      await insertEvents(optimistic);

      try {
        await putEvent(account, calendar, newUid, cloneIcs);
      } catch (error) {
        await removeWhere(account.id, (e) => seriesBaseUid(e.uid) === newUid);
        Alert.alert(i18n.t('event.errorDuplicateFailed'), describeMutationError(error));
        return;
      }
      uidRef.current = optimistic[0]?.uid ?? newUid;
    }, [account, calendars]),
  );
  return { ...action, getDuplicatedUid: () => uidRef.current };
}

export function useUpdateEvent(accounts: readonly Account[], calendars: CalendarMeta[]) {
  return useAction<{ event: CalendarEvent; input: CreateEventInput; scope?: RecurrenceEditScope; datesOnly?: boolean }, MutationResult>(
    useCallback(async ({ event, input, scope = 'all', datesOnly = false }): Promise<MutationResult> => {
      // Writes go to the event's own account — an event from server B must be
      // editable while account A is the default.
      const account = accounts.find((a) => a.id === event.accountId);
      if (!account) return 'failed';
      const base = seriesBaseUid(event.uid);
      const snapshot = await snapshotByBase(account.id, base);

      const { dtstart, dtend } = inputDates(input);
      const { deltaStart, deltaEnd } = seriesDeltas(event, dtstart, dtend);
      const shiftsWholeSeries = event.isRecurring && scope === 'all';
      const targetAccountId = input.calendarAccountId ?? event.accountId;
      const calendarChanged =
        !event.isRecurring &&
        (input.calendarId !== event.calendarId || targetAccountId !== event.accountId);
      const targetCal = calendarChanged
        ? calendars.find((c) => c.id === input.calendarId && c.accountId === targetAccountId) ??
          calendars.find((c) => calendarKeyOf(c) === input.calendarId)
        : undefined;
      // CalDAV MOVE is intra-server: a target calendar owned by another account
      // would need delete+create on two servers — not supported.
      if (targetCal && targetCal.accountId !== account.id) return 'failed';

      const nextLocation = input.location ?? event.location;
      const locationChanged = (nextLocation ?? '') !== (event.location ?? '');
      // Fresh coordinates supersede stored location-bound props; a rewritten
      // location invalidates them. Either way the stale lines must not be
      // carried into the rebuilt ICS.
      const dropStaleGeo = locationChanged || input.geo != null;
      const filterPreserved = (lines: string[]) =>
        dropStaleGeo ? dropLocationBoundLines(lines) : lines;

      const nonTemporalPatch = {
        summary: input.summary,
        allDay: input.allDay,
        description: input.description ?? event.description,
        location: nextLocation,
        geo: input.geo ?? (locationChanged ? undefined : event.geo),
        attendees: input.attendees,
        alarms: resolveAlarms(input),
        timezone: input.allDay ? undefined : inputTimezone(input) ?? event.timezone,
      };

      let marked: string[] = [];
      try {
        if (shiftsWholeSeries) {
          marked = await shiftSeriesDates(account.id, base, deltaStart, deltaEnd, datesOnly ? {} : nonTemporalPatch);
        } else {
          marked = await patchByUid(account.id, event.uid, {
            ...(datesOnly ? {} : nonTemporalPatch),
            dtstart,
            dtend,
            ...(targetCal && {
              calendarId: targetCal.id,
              color: targetCal.color,
              href: buildEventHref(targetCal, event.uid),
            }),
          });
        }

        const { location, description } = await resolveLocationAndDescription(account, input);
        let timezone = inputTimezone(input) ?? resolveTimezone(account);
        const scheduled = withServerOrganizer(input, event);

        if (!event.isRecurring || scope === 'all') {
          if (datesOnly) {
            const { ics: masterIcs, etag } = await fetchEventIcsWithEtag(account, event.href);
            const tz = masterTzid(masterIcs) ?? timezone;
            const sequence = extractSequence(masterIcs) + 1;
            let newStart = input.dtstart;
            let newEnd = input.dtend;
            if (event.isRecurring) {
              const bounds = extractDtstartDtend(masterIcs);
              if (!bounds) throw new Error('Cannot read the series master to shift it');
              newStart = new Date(bounds.dtstart.getTime() + deltaStart);
              newEnd = new Date(bounds.dtend.getTime() + deltaEnd);
            }
            const shifted = shiftIcsDates(masterIcs, newStart, newEnd, tz, input.allDay, sequence);
            const delta = await applyAttachmentDelta(account, shifted, input);
            try {
              await updateEvent(account, event.href, delta.ics, etag);
            } catch (error) {
              await cleanupUploaded(account, delta.uploadedPaths);
              throw error;
            }
            warnAttachmentFailures(delta.failures);
          } else {
            let uid = event.uid;
            let masterInput = scheduled;
            let sequence = 0;
            let preserved: string[] = [];
            let calendarLines: string[] = [];
            let etag: string | undefined;
            if (event.isRecurring) {
              const master = await fetchEventIcsWithEtag(account, event.href);
              const masterIcs = master.ics;
              etag = master.etag;
              timezone = inputTimezone(input) ?? masterTzid(masterIcs) ?? timezone;
              sequence = extractSequence(masterIcs) + 1;
              preserved = filterPreserved(extractExtraVeventLines(masterIcs));
              calendarLines = extractVtimezoneLines(masterIcs, timezone);
              const bounds = extractDtstartDtend(masterIcs);
              if (!bounds) throw new Error('Cannot read the series master to shift it');
              uid = seriesBaseUid(event.uid);
              masterInput = shiftedMasterInput(scheduled, bounds, deltaStart, deltaEnd);
            } else {
              try {
                const master = await fetchEventIcsWithEtag(account, event.href);
                const masterIcs = master.ics;
                etag = master.etag;
                timezone = inputTimezone(input) ?? masterTzid(masterIcs) ?? timezone;
                sequence = extractSequence(masterIcs) + 1;
                preserved = filterPreserved(extractExtraVeventLines(masterIcs));
                calendarLines = extractVtimezoneLines(masterIcs, timezone);
              } catch (error) {
                console.warn('[useUpdateEvent] failed to fetch master ics for sequence/extra lines:', error);
              }
            }
            const rebuilt = buildIcsForInput(uid, masterInput, location, description, timezone, sequence, preserved, calendarLines);
            const delta = await applyAttachmentDelta(account, rebuilt, input);
            try {
              await updateEvent(account, event.href, delta.ics, etag);
            } catch (error) {
              await cleanupUploaded(account, delta.uploadedPaths);
              throw error;
            }
            warnAttachmentFailures(delta.failures);
          }
          if (targetCal) {
            await moveEvent(account, event.href, targetCal, event.uid);
          }
        } else if (scope === 'this') {
          const { ics: masterIcs, etag } = await fetchEventIcsWithEtag(account, event.href);
          // Attachments are series-level: the delta is applied to the master
          // (which also gains the exception VEVENT), never to the exception VEVENT.
          const delta = await applyAttachmentDelta(account, masterIcs, input);
          const masterTz = masterTzid(masterIcs) ?? timezone;
          const exTz = inputTimezone(input) ?? masterTz;
          const exIcs = buildExceptionIcs({
            uid: seriesBaseUid(event.uid), summary: input.summary, description, location,
            geo: input.geo,
            dtstart: input.dtstart, dtend: input.dtend, allDay: input.allDay,
            organizerEmail: scheduled.organizerEmail, organizerName: input.organizerName,
            attendees: input.attendees, timezone: exTz, recurrenceId: occurrenceSlot(event), recurrenceIdTzid: masterTz,
            alarms: resolveAlarms(input),
            sequence: extractSequence(masterIcs) + 1,
            // ATTACH must not be copied into the exception (it inherits the
            // master's attachments at parse time — a copy would go stale), and
            // EXDATE lines are meaningless on a RECURRENCE-ID component.
            extraLines: filterPreserved(
              extractExtraVeventLines(delta.ics).filter(
                (l) => !/^(attach|exdate)[;:]/i.test(l),
              ),
            ),
            calendarLines: extractVtimezoneLines(masterIcs, exTz),
          });
          // The override lives in the series resource (CalDAV refuses a second one with its UID).
          try {
            await updateEvent(account, event.href, upsertOverride(delta.ics, exIcs), etag);
          } catch (error) {
            await cleanupUploaded(account, delta.uploadedPaths);
            throw error;
          }
          warnAttachmentFailures(delta.failures);
        } else if (scope === 'thisAndFollowing') {
          const { ics: masterIcs, etag } = await fetchEventIcsWithEtag(account, event.href);
          timezone = inputTimezone(input) ?? masterTzid(masterIcs) ?? timezone;
          const oneDayBefore = dayjs(occurrenceSlot(event)).subtract(1, 'day').endOf('day').toDate();
          const cal =
            calendars.find((c) => c.id === event.calendarId && c.accountId === event.accountId) ??
            calendars.find((c) => c.id === input.calendarId && c.accountId === targetAccountId);
          if (!cal) throw new Error('Calendar not found for new series');
          const newUid = Crypto.randomUUID();
          const seriesIcs = buildIcsForInput(newUid, scheduled, location, description, timezone, 0, filterPreserved(extractExtraVeventLines(masterIcs)), extractVtimezoneLines(masterIcs, timezone));
          const delta = await applyAttachmentDelta(account, seriesIcs, input);
          try {
            await updateEvent(account, event.href, truncateRruleUntil(masterIcs, oneDayBefore), etag);
            // The pending uploads are only referenced by the new series ICS —
            // if either write fails they are orphans.
            await putEvent(account, cal, newUid, delta.ics);
          } catch (error) {
            await cleanupUploaded(account, delta.uploadedPaths);
            throw error;
          }
          warnAttachmentFailures(delta.failures);
        }
        // Resync the source calendar and, when the event moved, the target one.
        const affectedCals = new Map<string, CalendarMeta>();
        const sourceCal = calendars.find((c) => c.id === event.calendarId && c.accountId === event.accountId);
        if (sourceCal) affectedCals.set(calendarKeyOf(sourceCal), sourceCal);
        const targetResyncCal = calendars.find((c) => c.id === input.calendarId && c.accountId === targetAccountId);
        if (targetResyncCal) affectedCals.set(calendarKeyOf(targetResyncCal), targetResyncCal);
        for (const cal of affectedCals.values()) {
          await resyncAfterAttachmentDelta(account, cal, input);
        }
        return 'ok';
      } catch (error) {
        await restoreSeries(account.id, base, snapshot);
        Alert.alert(i18n.t('event.errorUpdateFailed'), describeMutationError(error));
        return 'failed';
      } finally {
        releasePending(marked);
      }
    }, [accounts, calendars]),
  );
}

export function useDeleteEvent(accounts: readonly Account[]) {
  return useAction<{ event: CalendarEvent; scope?: RecurrenceEditScope }, MutationResult>(
    useCallback(async ({ event, scope = 'all' }): Promise<MutationResult> => {
      const account = accounts.find((a) => a.id === event.accountId);
      if (!account) return 'failed';
      const base = seriesBaseUid(event.uid);
      let removed: CalendarEvent[] = [];
      let marked: string[] = [];
      try {
        if (!event.isRecurring || scope === 'all') {
          removed = await removeWhere(account.id, (e) => seriesBaseUid(e.uid) === base);
        } else if (scope === 'thisAndFollowing') {
          const from = occurrenceSlot(event).getTime();
          removed = await removeWhere(
            account.id,
            (e) => seriesBaseUid(e.uid) === base && new Date(e.dtstart).getTime() >= from,
          );
        } else {
          removed = await removeWhere(account.id, (e) => e.uid === event.uid);
        }
        marked = removed.map((e) => eventKey(e.accountId, e.calendarId, e.uid));

        if (!event.isRecurring || scope === 'all') {
          await deleteEvent(account, event.href);
          return 'ok';
        }
        const { ics: masterIcs, etag } = await fetchEventIcsWithEtag(account, event.href);
        const timezone = masterTzid(masterIcs) ?? resolveTimezone(account);
        if (scope === 'this') {
          await updateEvent(account, event.href, injectExdate(masterIcs, occurrenceSlot(event), timezone), etag);
        } else if (scope === 'thisAndFollowing') {
          const oneDayBefore = dayjs(occurrenceSlot(event)).subtract(1, 'day').endOf('day').toDate();
          await updateEvent(account, event.href, truncateRruleUntil(masterIcs, oneDayBefore), etag);
        }
        return 'ok';
      } catch (error) {
        if (isNetworkFailure(error) && (!event.isRecurring || scope === 'all')) {
          // Offline: rows stay removed locally; the DELETE is replayed later.
          enqueue({ kind: 'delete', accountId: account.id, href: event.href });
          Alert.alert(i18n.t('event.deleteQueued'), describeMutationError(error));
          return 'queued';
        }
        await insertEvents(removed, { trackPending: false });
        Alert.alert(i18n.t('event.errorDeleteFailed'), describeMutationError(error));
        return 'failed';
      } finally {
        releasePending(marked);
      }
    }, [accounts]),
  );
}
