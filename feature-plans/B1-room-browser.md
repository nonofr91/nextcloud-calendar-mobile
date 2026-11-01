# B1 — Room/resource browser by building
> Scope tag: [upstream] | Effort: M | Targets: epic #254, PRs #231/#310 | Tracking: #382

## Goal & UX
A "Rooms" entry point in the find-time flow (and the attendee field) that lists **all**
rooms/resources without a search query — mirroring web Calendar 6.6's room browser
(calendar#7996/#8264): groups = building (`room-building-name`) → optional floor
(`room-building-story`); rows show name, capacity, floor/room number, feature chips
(PROJECTOR/WHITEBOARD/WHEELCHAIR-ACCESSIBLE…) and a live availability badge computed
from the existing free-busy plumbing. Tapping a room adds it as an attendee with
`cutype:'ROOM'` so it joins `useFreeBusy` lanes like any participant and is booked via
normal PUT/scheduling (server auto-accepts).
UI touchpoints: new `RoomBrowserSheet.tsx` (`src/features/event/components/`); opened from
`AttendeesField.tsx` (dev, :20-40), `FindTimeSheet.tsx` (v1, `feature/find-time-229`),
`FindTimeSuggestSheet.tsx` + `app/event/find-time.tsx` (v2, `feature/find-time-ux-v2`).

## Upstream dependencies & capability gating
- Rooms do **not** come from the OCS attendee endpoint: `apps/calendar/v1/autocompletion/attendee`
  returns `type:'individual'` only (`sharees.ts:55` filter is correct — **verify** on a live
  instance that `type:'room'` never appears; if it does, extend `parseContactEntry`).
- Web uses DAV **principal-property-search** / principal listing instead. Principals:
  `principals/calendar-rooms/<backend>-<id>` (`calendar-user-type=ROOM`) and
  `principals/calendar-resources/…` (`RESOURCE`) — verified in server
  `ResourceBooking/{Room,Resource}PrincipalBackend.php`.
- Metadata lives on the **principal** (proxied, server#16498), not the calendar collection —
  ns `{http://nextcloud.com/ns}`: `room-type`, `room-seating-capacity`, `room-building-name`
  (NC35, server#63244), `room-building-address`, `room-building-story`,
  `room-building-room-number`, `room-features`; resources: `resource-*` set.
- Gating: `room-building-name` needs NC35 → fallback = derive building from first
  comma-segment of `room-building-address` (same heuristic as web#8264). Get version via
  `ocs.data.version` in `fetchServerCaps` (`nextcloud.ts:79-99`) or just read both props and
  prefer `name` when present (simpler, no gating needed — preferred).
- Room calendars: live under `system-calendars/calendar-rooms/<id>` (server `Plugin.php`).
  **verify**: whether `app-generated--room--*`/`app-generated--resource--*` URIs (server#55282)
  also surface in the user `calendars/` PROPFIND handled by `fetchCalendars` — today only
  `app-generated--deck` is special-cased (`caldav.ts:239`, `sync.ts:287`).

## Implementation (files to touch/create, ordered steps)
1. `src/services/nextcloud/principals.ts` **(new)** — `fetchRoomsAndResources(account)`:
   PROPFIND `Depth:1` on `/remote.php/dav/principals/calendar-rooms/` and
   `…/calendar-resources/` (two calls, `settleAll`) requesting displayname,
   `calendar-user-type`, `calendar-user-address-set`, sabredav `email-address`, and the
   `room-*`/`resource-*` prop set above; reuse `splitResponses`/`decodeXmlEntities`
   patterns from `caldav.ts`. Optional phase-2: `principal-property-search` REPORT for
   server-side capacity/features filters (what web's `advancedPrincipalPropertySearch` does).
2. `src/types/index.ts` — `RoomResourcePrincipal` (below); `Attendee += cutype?:
   'INDIVIDUAL'|'ROOM'|'RESOURCE'|'GROUP'`.
3. `src/utils/rooms.ts` **(new)** — `groupRoomsByBuilding(rooms)` → `building → floor → rooms`
   sorted by capacity; `deriveBuilding()` = `roomBuildingName ?? firstSegment(address) ??
   'Other'`; `roomFeatures` CSV parser; client-side filter (text, min-capacity, features).
4. `src/features/event/hooks/useRooms.ts` **(new)** — fetch-once-per-account cache with the
   `useContactSuggestions`/debounce pattern; rooms change rarely (TTL ≥ contactCache 1h).
5. `src/features/event/components/RoomBrowserSheet.tsx` **(new)** — `Sheet` with collapsible
   building sections (List/Item/Chip ui components), filter row (min-capacity TextField,
   available-only Toggle, feature Chips), availability badge per room.
6. Availability: reuse `fetchFreeBusy` (branch `src/services/nextcloud/freeBusy.ts`) — pass
   selected/listed room emails as attendees; for the "all rooms" grid batch rooms into the
   same VFREEBUSY REQUEST (server accepts multiple ATTENDEE lines already).
7. Booking/write path: `ics.ts:95-100` `attendeeLines` — emit
   `CUTYPE=ROOM|RESOURCE;ROLE=REQ-PARTICIPANT` for room attendees (currently hardcoded
   `CUTYPE=INDIVIDUAL`, the exact iOS bug RoomVox patches server-side). `RSVP=TRUE;
   PARTSTAT=NEEDS-ACTION` is acceptable — server auto-accepts → PARTSTAT=ACCEPTED on read-back.
   `readAttendees` (`caldav-parse.ts:59-71`) must read the `cutype` param so round-trips
   preserve it (coordinate with R2 fix A1 which preserves all attendee params).
8. Free-busy ICS: add `;CUTYPE=` to `ATTENDEE` lines in `buildFreeBusyIcs` (branch file) —
   cosmetic but spec-correct; schedule-response matching is by `mailto:` so it works today.
9. `fetchCalendars`: **verify** then either leave `app-generated--room--*` as read-only
   calendars (their bookings render as normal events) or mark them `isRoomCalendar` to hide
   from calendar pickers/`supportsEvents` list — keep syncing events either way.
10. 403 surfacing on room booking (restricted room, server#57231 / resource-management
    group restrictions): depends on B2's `<s:message>` parsing in `errors.ts` — reuse the
    same `errorInviteRestricted` key; add `event.roomBookingRestricted` fallback copy.
11. Wire UI: `AttendeesField` "Rooms" button; v1 `FindTimeSheet` header action; v2
    `FindTimeSuggestSheet` + `find-time.tsx` (room chips/lane same as attendees — lanes
    already render any attendee). Room picks append to `attendees` with `cutype` set;
    `dedupeAttendees` unchanged (email key).
12. Rebase onto whichever find-time branch merges second; this feature post-dates both.

## Data model / types
```ts
type RoomResourcePrincipal = {
  email: string;                 // from sabredav email-address / calendar-user-address-set
  displayName: string;
  principalUrl: string;
  cutype: 'ROOM' | 'RESOURCE';
  roomType?: string;             // meeting-room|lecture-hall|seminar-room|other
  capacity?: number;
  buildingName?: string;         // room-building-name (NC35+)
  buildingAddress?: string;
  buildingStory?: string;        // floor
  roomNumber?: string;
  features: string[];            // room-features CSV
};
```
`Attendee.cutype` defaults to `'INDIVIDUAL'` when absent (existing rows/ICS unaffected).
Rooms are kept out of WatermelonDB — principal list is ephemeral state (cache in the hook).

## Edge cases & error handling
- No room backend installed → both prefixes return empty/404 → hide the "Rooms" button
  (don't error); single PROPFIND failure (one prefix) → show partial list.
- `principals/*` listing can be disabled on hardened instances (`disableListing`) → 403/empty
  → fall back to `principal-property-search` REPORT, else hide feature (**verify** which
  failure mode a hardened NC returns).
- Room without `email`/`calendar-user-address-set` → not bookable → grey out, no add.
- Missing building props → "Other" group; missing floor → flat list under building.
- Booking 403 (restricted room/group) → surface `serverMessage`; VFREEBUSY for rooms may
  return non-2.x `request-status` → mark badge "unknown", don't block (existing
  `available:false` path).
- Rooms auto-accept: don't surface "awaiting reply" UX for `cutype!=='INDIVIDUAL'`.
- Large estates (100+ rooms): batch VFREEBUSY (1 request, N attendees) not per-room calls.

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/services/nextcloud/principals.test.ts` **(new)**: 207 parsing of room/resource
  props, both namespaces (`nextcloud.com`), empty/404/403 paths, missing props.
- `__tests__/utils/rooms.test.ts` **(new)**: grouping (name present/absent → address
  heuristic → Other), floor ordering, capacity sort, filters.
- Extend `__tests__/utils/ics.test.ts`: room attendee line emits `CUTYPE=ROOM`; round-trip
  `readAttendees` keeps `cutype` (extend `caldav-parse` tests).
- Extend `__tests__/services/nextcloud/freeBusy.test.ts` (branch): room recipients' busy
  slots merge into `mergeBusySlots`; non-2.x status → `available:false`.
- Component test `RoomBrowserSheet`: renders sections, available-only filter, add →
  `Attendee{cutype:'ROOM'}`. `tsc --noEmit`; jest suite.
- Emulator (find-time-scenario.md pattern): needs NC35 + calendar_resource_management seeded
  via `occ calendar-resource:*` — verify building groups + badge + booking 403 case.

## Docs & i18n
- 9 locale files (`src/locales/*.json`): `event.rooms`, `roomBrowser.{title,search,
  availableOnly,minCapacity,floor,other,seats,booked,unknown}`, `roomBookingRestricted`.
- `README.md` + `USER_GUIDE.md` find-time section; GIF per `docs/*mockups` precedent.
- Note requirements: room metadata backend (calendar_resource_management 1.0 or RoomVox);
  `room-building-name` only on NC35 (else address-derived grouping).

## Open questions / arbitration notes
- **verify**: whether room/resource calendars appear in the user `calendars/` home as
  `app-generated--*` (docs/impact-analysis claims yes; `Plugin.php` implies they live under
  `system-calendars/…`) — decides step 9.
- **verify**: does the OCS attendee endpoint ever return `type:'room'`/`'resource'` on NC35?
  If yes, reuse `sharees.ts` for search-driven picking in addition to the principal listing.
- Listing vs search: PROPFIND Depth:1 is simplest and matches web#8264's "all rooms upfront";
  on hardened servers it may fail → keep principal-property-search as the phase-2 fallback.
- Should booked-room events sync into the agenda as read-only events (duplicates of the
  user's own meeting)? Proposal: keep syncing, dedupe by UID if overlap reported.
- Resources vs rooms in one sheet? Proposal: sections separated by `cutype` — arbitrate #382.
