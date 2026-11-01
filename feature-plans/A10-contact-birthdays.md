# A10 — Contact birthdays calendar
> Scope tag: [parity] | Effort: S | Targets: epic #250 | Tracking: #382

## Goal & UX
Nextcloud auto-generates a read-only system calendar at `.../calendars/<user>/contact_birthdays/`
(all-day VEVENTs `RRULE:FREQ=YEARLY` built from CardDAV birthdays). Goal: it must appear in the
drawer with a proper icon/label, sync its events, and be non-editable. Status: **mostly shipped on
`dev`** by PR #295 (`13133e6`) — `BIRTHDAY_CALENDAR_SLUG` (`src/services/nextcloud/caldav.ts:265`),
unbounded fetch, read-only classification, Cake icon (`CalendarDrawerRow.tsx:31-37`). Remaining work
is verification on real servers + small hardening.

## Upstream dependencies & capability gating
- Available on all supported NC versions (birthday collection exists since NC ~15); no capability
  gate needed — if the collection is absent from PROPFIND it simply never appears.
- verify: `current-user-privilege-set` is returned for `contact_birthdays` on the oldest supported
  NC (and on NC34/35). `isReadOnly` (caldav.ts:229-233) requires the prop; absent ⇒ writable ⇒
  events become editable. Defensive fallback proposed in step 2.
- verify: `supported-calendar-component-set` advertises `VEVENT` on the collection; absent ⇒
  `supportsEvents` defaults `true` (caldav.ts:235-244) — safe either way.
- verify: `REPORT sync-collection` works on the collection (birthdays are real `calendarobjects`
  rows in NC, so it should). `syncVisibleRange` routes non-`app-generated--` calendars to
  `syncCalendarDelta` (`src/database/sync.ts:287-300`); a failed delta already falls back to the
  range path (`sync.ts:300-307`).

## Implementation (files to touch/create, ordered steps)
1. `src/services/nextcloud/caldav.ts` `fetchEvents` (~373-385): skip the VTODO
   `reportCalendarObjects` call for `slug === BIRTHDAY_CALENDAR_SLUG` — it is a wasted REPORT per
   sync (errors are already swallowed by `required: false`, so this is cleanup only).
2. `src/services/nextcloud/caldav.ts` `fetchCalendars` (~229-233): belt-and-braces —
   `isReadOnly: isReadOnly || slug === BIRTHDAY_CALENDAR_SLUG` so a missing privilege-set can never
   expose the collection as writable (PUT/DELETE would 403 server-side anyway).
3. `src/features/calendar/components/CalendarDrawerRow.tsx`: when `isBirthday` and
   `displayName === calendar.slug` (empty `displayname` fell back to slug, caldav.ts:210-211), show
   localized fallback `t('calendar.drawerBirthdays')` instead of raw `contact_birthdays`.
   Keep server-provided name otherwise (NC already localizes "Contact birthdays").
4. `app/event/edit/[uid].tsx`: add a cheap guard — if the target `calendar.isReadOnly`, redirect
   back (`goBackOrHome`). Today the edit route is only reachable via the detail pencil, which is
   hidden when `canEdit` is false (`app/event/[uid].tsx:76,229-233`), but a deep link could bypass it.
5. Optional (arbitrate): group birthdays under a dedicated drawer section by extending
   `calendarGroup`/`CALENDAR_GROUPS` (`src/utils/calendars.ts:7-15`); default proposal is to keep it
   in `personal` — matches web, zero new UI.

## Data model / types
- No schema/type changes: `CalendarMeta.isReadOnly`/`supportsEvents`/`slug` (`src/types/index.ts:12-26`)
  and WatermelonDB columns (`src/database/models/Calendar.ts`, `sync.ts:34-48,78-92`) already carry
  everything. `CalendarEvent.readOnly` (`types/index.ts:71`) is set per-render by
  `useCalendarData.ts:63-71`.
- Birthday occurrences get `uid = '<uid>_occ_<unix>'` like any recurring event (caldav-parse.ts:326).

## Edge cases & error handling
- YEARLY expansion: handled by ical.js `icalEvent.iterator()` (caldav-parse.ts:336-357);
  `MAX_OCCURRENCES=1000` (15) / `MAX_ITERATIONS=50_000` (20) are ample — one occurrence/year even for
  century-old DTSTARTs; early `break` on `slotMs >= rangeEndMs` (347) bounds iteration.
- Feb-29 birthdays: RFC 5545 skips invalid dates — ical.js emits nothing on non-leap years. Verify
  parity with the web (same RFC semantics expected); document if divergent.
- Unknown birth year (`BDAY:--MMDD`): NC materializes a year (~1900) in DTSTART — expansion still
  works; no special handling needed.
- Unbounded REPORT on a huge contact list: VEVENT count = number of contacts with BDAY; bounded by
  payload size, not occurrence count. Acceptable; revisit only if a user reports sync slowness.
- `TRANSP:TRANSPARENT` on birthday VEVENTs is ignored by parsing — no busy/rendering distinction
  exists in the app; harmless.
- Server-side `VALARM` on birthdays flows through `alarmMinutesList` (caldav-parse.ts:45-57) → local
  notifications + per-calendar bell toggle already apply.
- Edit/delete attempts are blocked in UI (detail `canEdit`, drag guard `useEventDrag.ts:79`,
  `isWritableCalendar` `calendars.ts:3-5`); a stray PUT/DELETE 403s server-side — surfaced via
  `httpErrorFrom`, no crash.

## Tests (jest / tsc / caldav round-trip / emulator)
- Existing coverage: `__tests__/api/caldav.test.ts:181-209` (unbounded query + YEARLY expansion into
  window) and `:449-498` (privilege-set read-only detection on the birthdays href).
- Add: fixture asserting `isReadOnly === true` for `contact_birthdays` **without** a
  `current-user-privilege-set` prop (covers step 2); assert no VTODO REPORT is sent for the slug
  (step 1).
- Add `__tests__/utils/caldav-parse.test.ts` case: `DTSTART;VALUE=DATE:20000229` + `RRULE:FREQ=YEARLY`
  expanded over a non-leap year window → document actual behavior (skip vs emit).
- `yarn tsc --noEmit`; `yarn jest __tests__/api/caldav.test.ts`.
- Emulator/device vs real NC: enable Contacts birthdays, sync → cake row appears under CALENDARS,
  events visible in month/agenda/widget, pencil+delete hidden on detail, calendar absent from the
  creation picker; scroll ±18 months to confirm horizon expansion (`sync.ts:287-291`, horizon.ts).

## Docs & i18n
- New key `calendar.drawerBirthdays` in `src/locales/en.json` + 8 locales (de, es, fr, it, nl, oc,
  pt, ru) — only used as fallback when the server sends an empty `displayname`.
- Update `nextcloud-feature-proposals.md` A10 status → shipped (#295) + hardening PR ref; note in
  epic #250 / tracking #382.

## Open questions / arbitration notes
- Dedicated drawer group for birthdays vs staying in `personal` (step 5)? Proposed: stay — parity
  with web ordering, keeps `calendarGroup` unchanged.
- Should other `app-generated--*` collections (rooms/resources) share the slug-forced `isReadOnly`
  of step 2? Out of scope — covered by A7 in the impact analysis; note linkage.
- NC < oldest-supported: if `sync-collection` 404s on the collection, current fallback already
  covers it; no extra work unless a real server proves otherwise.
