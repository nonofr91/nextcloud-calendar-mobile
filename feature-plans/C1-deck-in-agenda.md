# C1 — Deck cards in the agenda
> Scope tag: [ecosystem] | Effort: M | Targets: issue #45, epic #256 | Tracking: #382

## Goal & UX
Deck exposes one read-only CalDAV calendar per board at
`.../calendars/<user>/app-generated--deck--board-<id>/`. Cards are **VTODOs** (upstream
deck#1545; repo fixtures `__tests__/utils/caldav-parse.test.ts:568-626`,
`UID:deck-card-*`, `DUE`) — the spec's "VEVENTs" is wrong (verify on server; parser handles both).
Current `dev` state is *more shipped than assumed*: deck calendars already appear in PROPFIND
(`fetchCalendars`, `src/services/nextcloud/caldav.ts:166-263`), are grouped under a DECK section
with per-board visibility/bell toggles (`CalendarDrawer.tsx:124-145`, `calendarGroup`
`src/utils/calendars.ts:10-15`), sync via the full-fetch path (`rangeOnly`,
`src/database/sync.ts:287-300`), and **already render** as undifferentiated `isTask` items in
month/week/agenda views. `supportsEvents:false` (caldav.ts:239-244) only removes them as write
targets (`isWritableCalendar`, `EventForm.tsx:67`) — it does *not* hide them.
C1 therefore = (a) opt-in default-off master toggle "Show Deck cards", (b) deck identity
(icon/dimmed style, "Deck" badge, optional "Open in Deck" link), (c) airtight read-only
guarantees, (d) clean merge-point with C2 (`feature/tasks-45`).

## Upstream dependencies & capability gating
- Requires the Deck app installed with its CalDAV backend enabled; boards appear automatically
  in the Depth:1 PROPFIND — no capability probe needed (absent ⇒ feature inert).
- verify: `current-user-privilege-set` on deck calendars (expected `{DAV:}read` ⇒ `isReadOnly`,
  caldav.ts:229-233); forced fallback in step 2 covers its absence.
- verify: real card VTODO shape — `URL` prop (deep link to card?), `RELATED-TO` → stack,
  `STATUS`/`CATEGORIES`, `VALARM`; and stack pseudo-VTODOs `deck-stack-*` (`SUMMARY:List : X`).
- verify: `calendar-query` `time-range` on VTODO matches on `DUE` (SabreDAV does); deck
  calendars lack `sync-collection` support ⇒ already pinned to full fetch (sync.ts:287).
- verify: spec claims VEVENT; if an older Deck emits VEVENTs the plan still holds (gating is
  calendar-level, not component-level).

## Implementation (files to touch/create, ordered steps)
1. `src/utils/calendars.ts`: add `isDeckCalendar(c)` (regex `/app-generated--deck/i` on `url`,
   today duplicated at caldav.ts:239 and calendars.ts:12); reuse in `calendarGroup`.
2. `caldav.ts` `fetchCalendars` (~239-244): force `isReadOnly` when `isDeckBoard` (same
   belt-and-braces as A10 birthdays) so a missing privilege-set can't expose edit affordances.
3. `caldav.ts` `fetchEvents` (~373-385): for `supportsEvents === false` calendars send the
   VEVENT `reportCalendarObjects` with `required:false` (or skip) — defensive against non-207
   on VTODO-only collections; VTODO report unchanged.
4. `src/stores/settingsStore.ts`: `showDeckCards: boolean` (default `false`, persisted via
   `partialize`; `migrate` already passes unknown fields through).
5. `src/features/calendar/hooks/useCalendarData.ts` (63-72): build a deck id-set from
   `calendars`; extend `nonEditableCalendarIds` with `supportsEvents === false`; when
   `showDeckCards === false` also drop deck-calendar events in `prepare()` (filter-at-read ⇒
   toggling is instant, no resync needed).
6. `src/features/widget/core/readEvents.ts` (`readUpcomingEvents`, 29-41): same deck gate ⇒
   widgets + `scheduleEventAlerts` (scheduleAlerts.ts:58-66) inherit it; `observeTodayEventsQuery`
   consumers (`useEventAlerts.ts`) are unchanged triggers.
7. Styling: deck icon (e.g. `SquareKanban`) on `AgendaView.tsx` `EventRow` (75-118) and
   `MonthDayView.tsx`/`TimeGridEvent.tsx` chips via calendarId→deck lookup; deck icon in
   `CalendarDrawerRow.tsx` beside `isBirthday` Cake pattern (31-37).
8. `app/event/[uid].tsx` `canEdit` (76): add `!event?.readOnly && calendar?.supportsEvents !==
   false`; show a "Deck" badge; add "Open in Deck" `Linking` button when `event.deckUrl`.
9. `app/event/edit/[uid].tsx`: deep-link guard — redirect back when the event's calendar is
   deck/`isReadOnly` (today only the hidden pencil protects it; same gap noted in A10 step 4).
10. Optional, after step-G verify: parse `URL` in `parseVtodo`/`parseIcsItem`
    (caldav-parse.ts:189-237,259-300) → `CalendarEvent.deckUrl` → persist (see data model) →
    feeds step 8. Fallback if no `URL` prop: derive board link from slug
    `app-generated--deck--board-<id>` → `<base>/index.php/apps/deck/board/<id>` (verify mapping).
11. C2 coordination: rebase `feature/tasks-45` first (stale — merge-base f02292c 2026-10-18;
    it predates `calendarGroup`/`isShared`/`order`/`MAX_ITERATIONS`). When merged, deck rows get
    the POC's checkbox (`Square`/`SquareCheck`); `canToggleTask`/`useToggleTask` already gate on
    `calendar.isReadOnly`/`event.readOnly` — step 2+5 make that airtight for deck.

## Data model / types
- `CalendarEvent.isDeck`/`readOnly`: derived at render in `useCalendarData.prepare` — no column
  needed (calendar-level attribute, like `readOnly` today).
- Optional `CalendarEvent.deckUrl?: string` ⇒ new `events.deck_url` column: `schema.ts` v10 +
  `addColumns` in `migrations.ts`, `models/Event.ts`, `writeEvent`/`eventUnchanged`
  (sync.ts:55-111), `mappers/event.ts`, `observedColumns.ts`, `useEvents.ts` `rowKey`.
- `settingsStore.showDeckCards` (persist key `settings-store`, version 2 — additive field).
- Deck cards keep `isTask:true` (VTODO) — identity keyed on the *calendar*, not the component.

## Edge cases & error handling
- Cards without `DTSTART`/`DUE`: `parseVtodo` drops them (no anchor, caldav-parse.ts:197-200) —
  matches "due dates only" UX; document.
- Stack VTODOs (`deck-stack-*`): expected undated ⇒ dropped by the same check; verify — if
  dated, filter `^deck-stack-` UIDs (or `RELATED-TO`-less VTODOs) inside deck calendars.
- All-day VTODO w/o VALARM inherits default `allDayAlerts` → due-date reminders fire (desired);
  per-board bell toggle already works (`notifDisabledCalendarIds`).
- Write paths are unreachable: picker filter (`isWritableCalendar`), drag guard
  (`useEventDrag.ts:79` — `isTask` covers VTODO, `readOnly` covers VEVENT), `canEdit`; a stray
  PUT/DELETE 403s server-side through `httpErrorFrom`.
- Toggle OFF⇄ON: instant (data kept in DB); per-board drawer toggles still apply on top.
- Deck board deleted/archived server-side: `syncCalendars` removes calendar + orphan events
  (sync.ts:136-147) — nothing extra.
- No Deck app: DECK drawer group empty (CalendarDrawer returns null per group); settings row
  shows but is inert — decide whether to hide it when no deck calendar exists.

## Tests (jest / tsc / emulator)
- `__tests__/api/caldav.test.ts`: fixture asserting `isReadOnly === true` for a deck href
  *without* privilege-set (step 2); VEVENT report sent with `required:false` for
  `supportsEvents:false` (step 3 — deck case exists at syncVisibleRange.test.ts:130-145).
- `__tests__/utils/calendars.test.ts`: `isDeckCalendar` cases (deck slug vs tasks vs personal).
- `useCalendarData` test: `showDeckCards=false` filters deck events but keeps normal tasks;
  `readOnly` stamped on deck events.
- `caldav-parse.test.ts`: `URL` prop → `deckUrl` (if step 10 lands); `deck-stack-*` fixture.
- `yarn tsc --noEmit`.
- Emulator vs real NC+Deck: boards listed under DECK; default toggle off ⇒ no cards; on ⇒
  all-day/icon rows; detail = badge, no pencil/delete, "Open in Deck" works; drag no-op;
  post-C2 checkbox disabled on deck rows; widgets/notifications respect flag.

## Docs & i18n
- New keys ×9 locales (`en,de,es,fr,it,nl,oc,pt,ru`): `settings.deckCards`,
  `settings.deckCardsHint`, `event.deckCard`, `event.openInDeck`. `calendar.drawerDeck` already
  exists in all locales.
- Update `nextcloud-feature-proposals.md` C1 (correct "VEVENT"→"VTODO", note partial shipping);
  reference issue #45, epic #256, tracking #382, PR #284.

## Open questions / arbitration notes
- Variant arbitration (#382): default proposal = read-only deck-styled rows on calendar views.
  Merging into the C2 tasks view instead couples C1 to the stale `tasks-45` rebase — recommend
  landing C1 standalone, then letting C2 absorb deck rows as read-only task entries.
- Default toggle state: spec says opt-in (off), but dev already shows cards ⇒ off-by-default is
  a behavior change for existing users; flag in the discussion.
- Hide the settings row and `WidgetCalendarSettings` entries when no deck calendar exists?
  Proposal: hide settings row only if zero deck calendars (avoids confusing non-Deck users).
- "Open in Deck": depends on the `URL` prop actually being emitted (verify on Deck 1.18/1.19);
  slug-derived fallback is second choice, drop the button otherwise.
