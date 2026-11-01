# A5 — Duplicate event
> Scope tag: [parity] | Effort: S | Targets: issue #175, epic #251 | Tracking: #382

## Goal & UX
Parity with web Calendar 6.6 (calendar#8605): one-tap "Duplicate" on the event detail
creates a copy **of the stored CalDAV resource** — same dates, attendees, alarms,
recurrence and unknown props — under a fresh UID. Mobile UX: a "Duplicate" button in the
detail footer next to Delete (`app/event/[uid].tsx:369-384`), same `canEdit` guard as
Edit/Delete (`:76` = `!isReadOnly && !isSubscribed && !isTask`). On success, navigate to
the copy's detail screen (first inserted row's uid); the source stays untouched.
Recommended UX = **direct duplicate** (no form detour) — matches the web's single action.
Pre-filled create form is the documented alternative (see Open questions).

## Upstream dependencies & capability gating
- None. Plain CalDAV GET + PUT, already used everywhere (`fetchEventIcs`
  `caldav.ts:410-417`, `putEvent` `caldav.ts:419-436`). Works on all supported NC versions.
- `putEvent` derives the resource filename client-side: `` `${calendar.url}${uid}.ics` ``
  (`caldav.ts:425`). The server does **not** assign a filename — `Crypto.randomUUID()`
  (`expo-crypto`, already used at `useMutateEvent.ts:203,331`) gives a collision-free
  uid/filename pair. UID inside the ICS must equal `newUid` — NC convention `uid.ics`
  (verify: SabreDAV tolerates a mismatch, but every existing writer keeps them equal).
- verify: whether PUT with attendees triggers iMIP invites (same exposure as
  `useCreateEvent` today) and whether `x-nc-scheduling` is honored on PUT — if yes,
  consider suppressing invites on duplication of someone else's event (see edge cases).

## Implementation (files to touch/create, ordered steps)
1. `src/utils/ics.ts`: new exported pure `cloneEventIcs(ics, newUid, now = new Date())`.
   Text-level surgery reusing the VEVENT block pattern of `editMasterVevent`/`upsertOverride`
   (`ics.ts:244-297`), applied to **every** VEVENT block (master + RECURRENCE-ID overrides):
   - `^UID:[^\r\n]*(\r?\n[ \t][^\r\n]*)*` → `UID:${newUid}` (consume folded continuations);
   - `^DTSTAMP[^\r\n]*` → `DTSTAMP:${utcStamp(now)}` (reuse private `utcStamp`, `ics.ts:28`);
   - `^SEQUENCE:[^\r\n]*` → `SEQUENCE:0`.
   Everything else — VALARMs, EXDATE/RDATE, override VEVENTs, ATTENDEE params, VTIMEZONE,
   `X-*` (incl. `X-NC-PARTY-CRASHER`) — survives byte-for-byte.
   Prefer this over `buildIcsForInput` + `extractExtraVeventLines` (`caldav-parse.ts:415`,
   the update path at `useMutateEvent.ts:291/300/321/332`): rebuild would drop override
   VEVENTs, rewrite ATTENDEE to `PARTSTAT=NEEDS-ACTION;RSVP=TRUE` (risk R2), rebuild
   VALARMs from minute offsets, and lose recurrence when `parseRrule` returns `undefined`.
2. `src/features/event/hooks/useMutateEvent.ts`: new `useDuplicateEvent(account, calendars)`
   mirroring `useCreateEvent` (197-225): resolve calendar via
   `resolveCalendar(calendars, event.calendarId)` (80-82) → `fetchEventIcs(account, event.href)`
   → `newUid = Crypto.randomUUID()` → `ics = cloneEventIcs(masterIcs, newUid)` → optimistic
   `insertEvents(parseIcsObjects([{ics, href: `${calendar.url}${newUid}.ics`}], meta,
   dtstart-1mo, dtstart+3mo))` (same window convention as `expandOccurrences`, 179-195;
   non-recurring parses range-free, `caldav-parse.ts:364-370`) → `putEvent` → on error
   `removeWhere(base=newUid)` + `Alert.alert(t('event.errorDuplicateFailed'),
   describeMutationError(error))` (delete's rollback shape, 342-378). Return the first
   inserted uid for navigation.
3. `app/event/[uid].tsx`: add `useDuplicateEvent`, footer `Button` with
   `testID="event-detail-duplicate"`, lucide `CopyPlus` (or `Files`; `Copy` already taken
   by location copy at `:292`), `loading/disabled` on `isPending`; then
   `router.push(`/event/${firstUid}`)` or `goBackOrHome` if the copy is off-window.
   For an occurrence (`uid` contains `_occ_`, `seriesBaseUid` `sync.ts:166`), `event.href`
   already points to the series resource → whole series duplicated, matching the web.
4. i18n keys (step in Docs) — no other UI.

## Data model / types
- No schema/type changes: `CalendarEvent`, `CreateEventInput`, WatermelonDB untouched.
- New export `cloneEventIcs` in `ics.ts`; hook signature
  `useDuplicateEvent(account, calendars)` → `useAction<{ event: CalendarEvent }>`.

## Edge cases & error handling
- Recurring events: always whole series (stored resource, incl. overrides/EXDATEs) —
  matches web; no scope prompt. verify: `event.href` is the resource href for occurrences
  (set from the REPORT item, `caldav-parse.ts:286,327`).
- Folded `UID:` (>75 chars, foreign ICS): handled by the continuation-consuming regex —
  covered by a unit test.
- Multi-UID resource (invalid but possible): only components whose UID equals the master's
  should be rewritten — decide in impl; safest is rewrite-all (NC stores single-UID).
- Attendees: clone keeps `ORGANIZER`/PARTSTAT verbatim. If user isn't the organizer the
  copy is a foreign-organized event in their calendar — same as web duplicate. iMIP
  re-invites risk on PUT → see dependency note; optional `x-nc-scheduling` header.
- Read-only/subscribed/task/Deck calendars: hidden by existing `canEdit`.
- Offline/PUT failure: optimistic rows rolled back, error alert via `describeMutationError`
  (`errors.ts:41`) — `no-uid-conflict` 409 practically unreachable with random UID.
- Copy outside the ±1mo/+3mo optimistic window: appears fully after next sync — same
  limitation as create; navigate only if a row was inserted.
- DETAIL: do NOT strip `LOCATION` Talk URLs — the copy pointing at the same room is
  desirable (verify intended).

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/utils/ics.test.ts` (exists): `cloneEventIcs` — UID rewritten in master +
  override blocks, DTSTAMP bumped, `SEQUENCE:0`, EXDATE/RRULE/VALARM/`X-*`/VTIMEZONE
  untouched, folded UID, missing SEQUENCE (no insert needed — PUT is create).
- `__tests__/api/caldav.test.ts`: no `putEvent` coverage today — add PUT URL/body/header
  assertion while here (optional but cheap).
- `__tests__/features/event/`: hook-level test in the `seriesShift.test.ts` style —
  export `cloneEventIcs` keeps it unnecessary; test the hook only if a DB harness exists.
- `yarn tsc --noEmit`.
- Emulator/e2e: `e2e/maestro/event/duplicate.yaml` mirroring `delete.yaml`
  (`event-detail-duplicate` tap → assert copy visible); round-trip vs real NC: duplicate a
  series with overrides + attendees → verify both resources on web, no invites check.

## Docs & i18n
- Keys: `event.duplicateEvent` ("Duplicate"), `event.errorDuplicateFailed`, optional
  `event.duplicated` confirmation — ×9 files `src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`.
- README "Event Management" list (`README.md:103`): add "Duplicate events" bullet.
- Update `nextcloud-feature-proposals.md` A5 status + note in issue #175 / tracking #382.

## Open questions / arbitration notes
- Direct duplicate (proposed) vs `/event/new?fromUid=` pre-filled form: `EventForm` already
  accepts `initialValues` incl. `rrule`/`alarms`/`attendees` (`EventForm.tsx:22-33`),
  `new.tsx` would map the source event — but loses overrides/EXDATEs/extra props on submit
  and breaks when `parseRrule` returns `undefined`. Keep as a later "Duplicate & edit…"
  second action if asked; not v1.
- Occurrence-level duplicate ("copy just this instance" → one-off VEVENT at the
  occurrence slot, `occurrenceTarget.ts`): out of scope; web duplicates the stored event.
- Navigate to the copy vs silent + confirmation: proposed push to copy detail.
- " (copy)" suffix on SUMMARY? Web keeps the title — match it.
- Duplicating FROM a read-only calendar INTO a writable one (nice UX, beyond web): reject
  for v1 or follow-up.
