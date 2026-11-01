# A4 — Event trash bin (recently deleted)
> Scope tag: [parity] | Effort: M | Targets: epics #250, #256 | Tracking: #382

## Goal & UX
Parity with the web Calendar "recently deleted" view. Nextcloud (≥22) keeps deleted
calendar objects under a per-user trash-bin DAV area; a new screen lists trashed
events/tasks (title, dates, `deleted-at`), newest first, with per-item **Restore**.
Phase 2 adds **Delete permanently** (+ optional "empty bin"). Entry point: a
"Recently deleted" item at the bottom of `CalendarDrawer` (web parity: the web
sidebar exposes the bin under the calendar list) → `router.push('/trashbin')`.
Restore is the canonical server verb — `MOVE trash-href → Destination:
<caldav-base>/<user>/trashbin/restore/<name>` — so the server reinstates the object
into its *original* calendar (server#26083); no target guessing, full ICS
(master + overrides) preserved.

## Upstream dependencies & capability gating
- List: `REPORT <base>/remote.php/dav/calendars/<davUserId>/trashbin/objects/`
  Depth 1 with `c:calendar-query` — a filter is mandatory (Sabre) but ignored, so
  reuse `calendarQueryBody('VEVENT', start, end, false)` (caldav.ts:271-288).
  Request `<d:getetag/>`, `<c:calendar-data/>`, `<ncc:deleted-at/>` with
  `xmlns:ncc="http://nextcloud.com/ns"` (int unix-ts; Trashbin Plugin
  `PROPERTY_DELETED_AT`).
- verify: trash hrefs are `.../trashbin/objects/<id>.ics` (numeric id in docs) —
  always use the returned href verbatim and its basename for the restore
  Destination; never reconstruct.
- Capability: no OCS flag exists. First REPORT → 207 supported; 404/405 → hide the
  drawer entry or render "unavailable". Admin `calendarRetentionObligation = 0`
  disables the bin (DELETE is permanent, listing stays empty) — indistinguishable
  from an empty bin; document, don't gate.
- NC34+ (server#60648, merged 2026-06): the bin also lists objects from calendars
  shared to the user or delegated → restore/perm-delete on a read-only shared
  source → 403 ("Read-only sharees cannot permanently delete trashbin entries").
- NC35 server#61881: a PUT recreating the same UID force-cleans the trash entry →
  re-PUT works as a fallback restore, but is inferior (pre-NC35 it fails
  "Deleted calendar object with uid already exists"; original calendar unknown —
  ICS carries only UID). Prefer MOVE; surface failures via `describeMutationError`.
- Deleted *calendars* (resourcetype `{http://nextcloud.com/ns}deleted-calendar`)
  are already filtered by `fetchCalendars` (caldav.ts:202). Restoring whole
  calendars uses the same MOVE pattern — out of scope, possible follow-up.

## Implementation (files to touch/create, ordered steps)
Phase 1 — list + restore:
1. `src/types/index.ts`: `DeletedCalendarObject = { trashHref, etag?, deletedAt?:
   Date, ics: string, event: CalendarEvent }` (`calendarId` unknown → pseudo-id
   `'__trashbin__'`).
2. `src/services/nextcloud/caldav.ts`: `fetchTrashObjects(account)` — REPORT on
   `calUrl(account, 'trashbin/objects/')` (calUrl, :11-13); parse with existing
   `splitResponses`/`absUrl`/`decodeXmlEntities` + prefix-agnostic `deleted-at`
   regex; feed `{ics, href}` to `parseIcsObjectsAsync` unbounded (meta calendarId
   `'__trashbin__'`, neutral color). `restoreTrashObject(account, trashHref)` —
   MOVE, `Destination: calUrl(account, 'trashbin/restore/') + basename`. Phase 2:
   `deleteTrashObject(account, trashHref)` — DELETE (same pattern as
   `deleteEvent`, :473-480).
3. `src/features/trashbin/useTrashBin.ts` (new): fetch-on-mount hook —
   `{ items, isLoading, error, refetch, restore, remove }`. **No WatermelonDB
   persistence**: rare-access, perishable, server-expiring; restored objects
   re-enter `events` via the normal sync path (no schema change).
4. `app/trashbin.tsx` (new top-level route, pattern of `app/event/[uid].tsx`):
   rows sorted `deletedAt` desc (absent last), relative deleted date, `isTask`
   badge, Restore button (+ phase-2 destructive action behind `Alert.alert`).
5. `CalendarDrawer.tsx`: append a "Recently deleted" `Item` (lucide `Trash2`)
   after the `CALENDAR_GROUPS` block (~:118-140); wire `onNavigateTrash →
   router.push('/trashbin')` in `app/(tabs)/calendar/index.tsx` (:225-241,
   alongside `onNavigateSettings`), behind navGuard like other pushes.
6. After a successful restore: remove the row, then call
   `syncVisibleRange(activeAccount, calendars, monthRange(new Date()))`
   (useCalendarData.ts:49 pattern) — the original calendar is unknown so sync,
   not the trash flow, discovers the reinstated object via delta multiget.
Phase 2:
7. `deleteTrashObject` + row action + confirm dialog; optional "Empty bin"
   iterating sequential DELETEs.

## Data model / types
- `DeletedCalendarObject` per step 1. `deletedAt` = seconds unix-ts →
  `new Date(ts * 1000)`; tolerate missing.
- No WatermelonDB change: `events`/`calendars` tables untouched; restored objects
  come back as ordinary inserts in `syncCalendarDelta` (sync.ts:327-405) /
  `syncEvents` — no tombstone flag needed.
- VTODOs land in the same bin (`parseVtodo` already yields `isTask`,
  caldav-parse.ts:235) — keep the flag, badge them in UI.

## Edge cases & error handling
- REPORT 404/405 → "unavailable" state (old server / disabled), not an error.
- Retention expiry between list and action → MOVE/DELETE 404 → drop the row
  silently + toast "already purged".
- 403 on restore/delete of shared-source objects (server#60648) → surface server
  message, keep the row.
- Restored series: the trash object holds the whole ICS — one MOVE restores
  master + exceptions; nothing special to do.
- A restored event outside the expansion horizon may not appear until the window
  covers it (existing `fetchEventsByHrefs` range behaviour) — acceptable; note in
  docs.
- Never DELETE/MOVE `.../trashbin` itself (403, immutable system collection).
- Offline: listing fails → reuse the standard error/empty state; restore queued
  mutations are out of scope (D4).

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/api/caldav.test.ts` (existing fetch-mock style): REPORT targets
  `trashbin/objects/` + carries `ncc` xmlns; 207 fixture → href/deleted-at/ICS
  parsed (arbitrary prefixes, missing deleted-at); 404 → supported=false.
- Unit: restore Destination = `trashbin/restore/<basename>`; DELETE href passthrough.
- `yarn tsc --noEmit`.
- Emulator vs real NC ≥32: delete in app → row appears with deleted-at → restore →
  event back after sync; perm-delete → gone server-side; cross-check web bin.
- Retention=0 / old-server fixture → graceful unavailable state.

## Docs & i18n
- New `trashbin.*` keys + `calendar.drawerTrash` in `src/locales/en.json` + 8
  locales (fr es pt it nl de ru oc): title, empty, restore, deletePermanently,
  confirmDeleteTitle/Msg, errorRestore, errorDelete, unavailable, deletedAtLabel.
- Update `nextcloud-feature-proposals.md` A4 status; note in epics #250/#256 and
  tracking #382 that retention is admin-controlled (empty bin ≠ bug).

## Open questions / arbitration notes
- Show trashed VTODOs (proposed: yes, badged) or events-only like the web?
- Restore UX: optimistic row removal + background sync (proposed) vs await sync.
- Entry point: drawer footer (proposed, web parity) vs item on
  `app/(tabs)/settings/account/[id].tsx`.
- Phase-2 scope: per-item perm-delete only, or also "Empty bin" bulk action?
- Whole-calendar trash restore — defer to a separate proposal or fold into #250?
