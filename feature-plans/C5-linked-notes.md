# C5 — Linked notes/collectives

> Scope tag: [mobile+ light] | Effort: S | Targets: epic #251 | Tracking: #383

## Goal & UX

Attach "meeting minutes" links (Nextcloud Notes / Collectives page / any URL) to an event, stored
in the ICS as `RELATED-TO`, so the link round-trips through CalDAV and opens from the event.

- Event detail (`app/event/[uid].tsx`): new "Linked notes" section — `SectionHeader` + `List`/`Item`
  rows (FileText icon, label + URL), tap → `Linking.openURL` (same pattern as description links,
  `linkify` at `src/utils/linkify.ts`, rendered at `[uid].tsx:162-165,328-346`).
- Editor (`src/features/event/components/EventForm.tsx`): new `LinkedNotesField` after
  `AttendeesField` — "Link a note" opens a picker listing Notes-app notes (title/category), plus a
  paste-URL row for Collectives or arbitrary links; added links shown as removable rows (mirrors
  `AttendeesField.tsx:100-118`).

## Upstream dependencies & capability gating

- **Notes API correction**: spec's `GET /ocs/v2.php/apps/notes/api/v1/notes` is wrong — Notes REST
  API v1 is an app endpoint, not OCS: `GET {base}/index.php/apps/notes/api/v1/notes` (Basic auth,
  plain JSON array `[{id,title,category,modified,etag,...}]`, `?exclude=content` to slim the list).
  Keep the `index.php`-less fallback (pattern `sharees.ts:29-34`, some servers have pretty URLs).
- Gating: `capabilities.notes.api_version` contains `"1.x"` (Notes ≥3.3) — extend `fetchServerCaps`
  (`src/services/nextcloud/nextcloud.ts:79-99`, reads `ocs.data.capabilities`) with
  `notesEnabled`; default in `accountStore.ts:17`; consume like `TalkToggle.tsx:17`. No capability →
  hide picker, keep paste-URL. In-app note read (`GET .../notes/{id}` → `content`) deferred.
- `trustedFetch` (`src/services/shared/trustedFetch.ts:139`), `useIsOnline`
  (`src/services/shared/network.ts:29`) for offline-disabled picker.

## Implementation (files to touch/create, ordered steps)

1. `src/types/index.ts` — `EventLink`; `CalendarEvent.relatedLinks?`; `CreateEventInput.relatedLinks?`;
   `ServerCapabilities.notesEnabled`.
2. `src/utils/caldav-parse.ts` — **add `'related-to'` to `WRITER_MANAGED_PROPS` (line 409-413)**.
   Critical: without it, `extractExtraVeventLines` (415) re-emits the old line forever — links
   become unremovable and edits duplicate. Parse `vevent.getAllProperties('related-to')` into
   `base` (line 284-300): http(s) values → `EventLink`; others → keep `raw` for verbatim re-emit.
3. `src/utils/ics.ts` — `relatedLines(links)` emitting `RELATED-TO;RELTYPE=SIBLING;VALUE=URI:<url>`
   (URI type avoids TEXT escaping; `encodeURI` non-ASCII — verify ical.js round-trip) or `link.raw`
   for foreign lines; splice into `buildIcs`/`buildAllDayIcs`/`buildExceptionIcs` before extraLines
   (lines 161, 195, 239).
4. DB: `schema.ts` → version 10, `related_links` TEXT optional; `migrations.ts` `toVersion:10`
   `addColumns`; `models/Event.ts` field; `sync.ts` `writeEvent`/`eventUnchanged`;
   `eventWrites.ts applyPatch`; `mappers/event.ts` JSON parse (pattern: attendees/alarms);
   `observedColumns.ts`.
5. `src/services/nextcloud/notes.ts` **(new)** — `fetchNotes(account)` + capability already in
   `nextcloud.ts`; note→URL builder (**verify** web route: note id is the file id →
   `{base}/index.php/f/{id}` opens Files; Notes SPA deep link format TBD on live instance).
6. `src/features/event/components/LinkedNotesField.tsx` **(new)** — picker + URL input; props like
   `AttendeesField` (`account`).
7. `EventForm.tsx` + `InitialValues` + `handleSubmit` (207-211); `app/event/edit/[uid].tsx:74-85`
   initialValues; `eventToInput.ts` (drag path uses `datesOnly`, links untouched — safe).
8. `app/event/[uid].tsx` — "Linked notes" section; open via `Linking.openURL` (+ optional
   `promptTalkRoomOpen`-style chooser later).
9. `useMutateEvent.ts` — `buildIcsForInput` passes `input.relatedLinks` → builders (lines
   101-115); update path already re-emits via preserved+managed flow.

## Data model / types

```ts
type EventLink = { url: string; label?: string; reltype?: string; raw?: string };
// raw = original ICAL line for foreign/non-URI RELATED-TO (round-trip verbatim, hidden in UI)
```

`CalendarEvent.relatedLinks?: EventLink[]`; column `related_links` = JSON. RELATED-TO on master
VEVENT only (occurrences inherit display via base parse; `buildExceptionIcs` copies lines into
overrides — acceptable).

## Edge cases & error handling

- Foreign `RELATED-TO` (UIDs, RELTYPE=PARENT from other clients) → preserved via `raw`, never shown.
- Removing a link: prop is writer-managed → omission on rewrite = deletion (this is why step 2 is
  mandatory).
- Read-only/subscribed calendars + `isTask` → no edit field (`canEdit` `[uid].tsx:76`); display stays.
- Notes fetch fails/offline → picker shows inline error/empty state; paste-URL still works.
- URL validation: `https?://` only in UI; `VALUE=URI` line `encodeURI`'d; `foldLine` handles >75B.
- Notes capability off → field degraded to paste-URL only.

## Tests (jest / tsc / emulator)

- Extend `__tests__/utils/caldav-parse.test.ts`: RELATED-TO URI parse → `relatedLinks`; foreign
  RELTYPE → `raw`; absent → undefined.
- Extend `__tests__/utils/ics.test.ts`: emit line, `raw` passthrough, removal round-trip.
- New `__tests__/services/nextcloud/notes.test.ts`: JSON parse, `exclude=content`, 404/index.php
  fallback; extend `nextcloud.test.ts` for `notesEnabled` capability.
- Extend `EventForm.test.tsx` (link rows add/remove), `eventToInput.test.ts`, sync/mapper test.
- `tsc --noEmit`; jest suite. Emulator: real NC + Notes — link a note, edit/remove it, verify ICS
  via PROPFIND and persistence after re-sync; Collectives paste-URL; offline picker disabled.

## Docs & i18n

- 9 locales `src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`: `event.linkedNotes`,
  `event.linkNote`, `event.pasteLinkUrl`, `event.openLink`, `event.notesUnavailable`,
  `event.notesEmpty`.
- README/USER_GUIDE event-editing section: RELATED-TO semantics, Notes vs Collectives (Collectives
  = paste URL only), "requires Notes app" note.

## Open questions / arbitration notes

- **Property choice (needs #382 arbitration)**: `RELATED-TO;RELTYPE=SIBLING;VALUE=URI` (RFC-clean,
  SIBLING = peer artifact — vs CHILD if minutes seen as output of the meeting) vs `X-NC-NOTE-URL`
  (unambiguous, NC-only, but custom) vs description URL only (zero schema change, `linkify` already
  tappable — viable v0 if schema bump is rejected).
- Note web URL format — verify on live server (`/apps/notes` deep link vs `/f/{fileId}`).
- Single vs multiple links (type supports N; UI could start with 1).
- In-app read-only note view (`GET /notes/{id}` content, markdown render) — deferred, would be M.
- Collectives has no stable public list API — verify; paste-URL path covers it.
