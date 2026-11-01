# A2 — Delete without notifying attendees
> Scope tag: [parity] | Effort: S | Targets: epic #251, PR #226 | Tracking: #382

## Goal & UX
When the user deletes an event that has attendees and that they organize, offer a
"Notify attendees" option in the delete confirmation so the iTIP/iMIP cancellation
emails can be suppressed via the `x-nc-scheduling` flag (server#58203, NC34,
backported stable31–33). Wire format **verified**: HTTP **header**
`x-nc-scheduling: false` on the DELETE — server reads
`$request->getHeader('x-nc-scheduling') === 'false'` (literal lowercase) in
`apps/dav/lib/CalDAV/Schedule/Plugin.php`; the same header is honored on PUT since
server#49503. Default: **ON** (notify), matching today's behaviour and web parity —
suppressing mail is the deliberate opt-in. Recommended UX: swap `Alert.alert` for the
existing `Dialog` + `Toggle` row + Cancel/Delete buttons only in the organizer+attendees
case (cheapest fallback: a third Alert button "Delete without notifying", but Android
caps `Alert` at 3 buttons and phrasing is cramped — discuss).

## Upstream dependencies & capability gating
- No gate needed: backported to NC31–33 + 34; unknown header is ignored by older and
  non-Nextcloud CalDAV servers (they still notify — same as today, silently).
- verify: web client wording in `nextcloud/calendar` delete dialog (PR #6890 added a
  "cancelling event" confirmation); mirror its semantics, not necessarily its copy.
- Attendee/organizer data already local: `CalendarEvent.attendees`/`organizerEmail`
  (`src/types/index.ts:63-64`), parsed by `readAttendees`/`organizerEmailOf`
  (`src/utils/caldav-parse.ts:59-77`), persisted (schema.ts:20-21) — no DB change.

## Implementation (files to touch/create, ordered steps)
1. `src/services/nextcloud/caldav.ts:473` `deleteEvent(account, href)` → add
   `opts?: { suppressScheduling?: boolean }`; when true send
   `headers: { 'x-nc-scheduling': 'false' }` (davFetch already merges headers, 66-78;
   passes through `trustedFetch`→`TlsTrust` `toRecord`, trustedFetch.ts:65-75).
2. Same file, `updateEvent` (438-453): add identical `opts` — needed because
   `useDeleteEvent` scopes `this`/`thisAndFollowing` are PUTs (EXDATE injection /
   RRULE truncation, useMutateEvent.ts:367-370) that DO trigger iTIP (upstream bug
   reports confirm mails on partial deletes). Optional scope-cut, see open questions.
3. `src/features/event/hooks/useMutateEvent.ts:342` `useDeleteEvent`: extend action
   value to `{ event, scope?, suppressScheduling? }`; pass through at line 361 (and
   to `updateEvent` at 367/370 if step 2 kept). Local `removeWhere`/`insertEvents`
   rollback unchanged — flag is transport-only.
4. `app/event/[uid].tsx` `handleDelete` (124-153): compute
   `canSuppress = event.attendees.length > 0 && isOrganizer(event, account)` where
   `isOrganizer` compares `event.organizerEmail` (mailto already stripped) with
   `resolveOrganizer(account).organizerEmail` (`src/features/event/utils/organizer.ts:3-9`),
   case-insensitive — new tiny helper (in organizer.ts or inline). When `canSuppress`,
   open a `Dialog` (`src/ui/components/Dialog.tsx`) with `Toggle` "Notify attendees"
   (default on) + destructive `Button`; otherwise keep current `Alert.alert`. Flow stays
   two-step: `askRecurrenceScope` first (recurring), then confirmation.
   Only delete entry point — no other callers (`useDeleteEvent` used solely here).
5. i18n keys (see below); no changes to `ics.ts`/parser needed — flag is a header,
   not an ICS property. `X-NC-DISABLE-SCHEDULING` ICS prop is a different mechanism —
   do NOT write it.

## Data model / types
- No schema/type changes to persisted models. Local-only additions:
  `DeleteEventOptions { suppressScheduling?: boolean }` on `deleteEvent`/`updateEvent`
  params; action value type of `useDeleteEvent` gains `suppressScheduling?: boolean`.
- Helper `isOrganizer(event, account): boolean` — `organizerEmail` may be `undefined`
  (foreign/legacy events) → treat as not-organizer → hide toggle (safe default:
  server still sends whatever it would send today).

## Edge cases & error handling
- `account.email` unset → `resolveOrganizer` falls back to `username@hostname`; if the
  comparison fails the toggle just doesn't show — never offer suppression we can't scope.
- Non-organizer deleting an invitation: keep toggle hidden — server-side implicit
  DECLINE/REPLY to the organizer should keep flowing (suppressing it would strand them).
- Partial-scope delete (`this`/`thisAndFollowing`) is a PUT on the series, not a DELETE:
  without step 2 the "don't notify" choice is silently ignored → either implement step 2
  (header honored on PUT too) or hide the toggle for `scope !== 'all'` — arbitrate.
- Shared calendars where user can write but isn't organizer → same not-organizer path.
- Header silently ignored on old/non-NC servers → attendees still notified; UX copy must
  not promise suppression ("Don't send cancellation emails" not "won't be notified").
- 404-on-delete tolerance (caldav.ts:478) and rollback (`insertEvents`) unchanged.

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/api/caldav.test.ts` `describe('deleteEvent')` (30-53): extend — with
  `suppressScheduling: true`, `mockFetch` (TlsTrust mocked in jest.setup.js:23-33 →
  `global.fetch`) receives `headers` containing `x-nc-scheduling: 'false'`; absent by
  default; 404/error paths unchanged. Same for `updateEvent` if step 2 kept.
- Unit-test `isOrganizer`: match, case-mismatch, undefined `organizerEmail`, email fallback.
- `yarn tsc --noEmit` for the signature/threading changes.
- Round-trip (manual or e2e, `e2e/nextcloud.ts:128` delete helper could take the header):
  on a real NC34, delete an attendee-event with flag → no cancellation mail; without →
  mail sent. NC33 regression: identical behaviour (backport), pre-31: ignored header,
  event still deleted, mail sent.
- Emulator: delete dialog renders toggle only for organized attendee-events; toggle
  state → flag reaches `deleteEvent` (jest-render or manual).

## Docs & i18n
- New `event.*` keys in all 9 locales (en, fr, es, pt, it, nl, oc, de, ru — same block as
  `deleteConfirmMsg`, en.json:175): `notifyAttendees` ("Notify attendees"), optional
  `notifyAttendeesHint` ("Send a cancellation email"), `deleteWithoutNotify` if the
  3-button fallback is chosen.
- Note in epic #251 / tracking #382 that suppression is NC31+ only (silent fallback).

## Open questions / arbitration notes
- Toggle ON (notify, recommended — least surprise, web parity) vs OFF by default? If the
  goal is "stop spamming" (R2-adjacent), OFF saves a tap; but silently dropping
  cancellations is a worse failure than an extra email. Keep ON.
- Extend suppression to the PUT-based partial scopes (step 2) or restrict the toggle to
  full deletes? Recommend extend — same user intent.
- Custom `Dialog`+`Toggle` (spec's checkbox, ~40 LOC) vs 3rd `Alert` button (zero new UI,
  cramped, Android 3-button limit is free today but tight if copy grows)? Recommend Dialog.
- verify: does the web expose "don't notify" per delete, or only the generic confirmation?
  If web lacks the toggle entirely, this is light [upstream] parity, still fine.
- Apply same flag on future PUT-update UI ("update without notifying", edit screen)?
  Out of scope here — note as follow-up; header plumbing in `updateEvent` enables it.
