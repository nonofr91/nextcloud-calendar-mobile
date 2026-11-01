# B5 — Tentative invitation rendering (iMIP)
> Scope tag: [parity] | Effort: S | Targets: epic #251 (depends A3) | Tracking: #382

## Goal & UX
Mail 5.11/5.12 improves server iMIP: received invitations now auto-materialize as
tentative VEVENTs that arrive via normal sync (`caldav.ts` REPORT). Parity with web
Calendar: an event where **my own** ATTENDEE is `PARTSTAT=NEEDS-ACTION` (or
`TENTATIVE`) renders subtly — outline/dashed card instead of solid fill — plus an
"Invitation" badge, instead of looking like a committed event. Phase 1: display only.
Phase 2 (separate PR): Accept / Maybe / Decline buttons on the detail screen.
Verified today: `readAttendees` (`src/utils/caldav-parse.ts:59-72`) keeps only
`email` + `displayName` (CN) — PARTSTAT/RSVP/ROLE are dropped; `Attendee`
(`src/types/index.ts:28-31`) has no status field; `ics.ts:95-100` rewrites every
ATTENDEE as `PARTSTAT=NEEDS-ACTION` on update (risk R2 — invitations re-spammed).

## Upstream dependencies & capability gating
- No server gate: PARTSTAT is RFC 5545; auto-created iMIP events arrive on any
  Mail ≥5.11 + any NC — absent PARTSTAT just renders as normal.
- "Me" identification: match ATTENDEE cal-address against `account.email`
  (OCS userinfo, `nextcloud.ts:32-55`, may be empty), `account.username` when it
  contains `@`, `account.davUserId`. verify: NC may write the attendee URI as
  `principals/users/<uid>` (no `mailto:`) when the user has no email — match the
  principal slug too.
- `calendar-user-address-set` (all mailto:/principal aliases of the principal) is
  **not** requested anywhere — `fetchCalendars` PROPFIND body
  (`caldav.ts:168-186`) lacks it. Plan a Depth-0 PROPFIND on
  `/remote.php/dav/principals/users/<davUserId>/` (pattern already used in
  `validateCredentials`, `caldav.ts:96-116`); parse `d:href` list; degrade
  gracefully to email/username when absent.
- Phase 2 dependency: **A3** (attendee-param preservation, fixes R2) — replying
  rewrites PARTSTAT on my ATTENDEE only; without A3 a save clobbers every other
  attendee's status. Reuse `fetchEventIcs`/`updateEvent` + `extractSequence`+1.

## Implementation (files to touch/create, ordered steps)
Phase 1 — display:
1. `src/types/index.ts:28-31` `Attendee`: add optional `partstat?: 'NEEDS-ACTION' |
   'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'DELEGATED'`, `rsvp?: boolean`,
   `role?: string`. `CalendarEvent`: no new field — derive per render.
2. `caldav-parse.ts` `readAttendees` (59-72): read `partstat`/`rsvp`/`role` params
   via `prop.getParameter(...)`; keep first-occurrence on dedupe. `exceptionFields`
   (99-100) inherits it free. Also capture partstat on ORGANIZER-side? No — ORGANIZER
   carries none.
3. New `src/features/event/utils/participation.ts`: `resolveMeAddresses(account,
   extraAliases?: string[])` → `Set<string>` of lowercase emails + `davUserId` slug;
   `myPartstat(event, me)` → status or `undefined` (skip when
   `organizerEmail` ∈ me — I'm the organizer, not an invitee).
4. `caldav.ts`: `fetchCalendarUserAddressSet(account)` — Depth-0 PROPFIND on the
   principal, `<c:calendar-user-address-set/>` (xmlns `c` already declared);
   reuse `splitResponses`/`decodeXmlEntities`; returns `string[]`.
   `auth.ts:70-72` refresh path (or settings screen): persist on a new optional
   `Account.calendarUserAddresses?: string[]` — no account-table migration.
5. Rendering — thread a `meSet` memo (`useMeAddresses(account)` tiny hook) into
   views, or compute inside `useCalendarData` and pass down `isInvitation` flag:
   - `TimeGridEvent.tsx` (64-77): when `myPartstat` is NEEDS-ACTION/TENTATIVE →
     `backgroundColor: 'transparent'` (or `color+22` alpha), `borderColor: color`,
     `borderWidth: 1`, `borderStyle: 'dashed'`; title uses `theme` ink not card ink.
   - `AgendaView.tsx` `EventRow` (75-118): same subtle row + small `Chip`
     "Invitation" next to the meta line.
   - `MonthDayView.tsx` day list rows (282-298) + `MonthGridPage.tsx` chips
     (~38-66): dashed/alpha variant.
   - `app/event/[uid].tsx`: banner "Invitation from <organizer display>" +
     highlight the "you" attendee row; section still lists attendees.
6. `src/hooks/useMeAddresses.ts` (or inside `useCalendarData`): memoize
   `resolveMeAddresses(activeAccount, activeAccount.calendarUserAddresses)`.
Phase 2 — actions (needs A3):
7. `[uid].tsx`: Accept / Maybe / Decline buttons when `myPartstat` is
   NEEDS-ACTION/TENTATIVE (and `canEdit`-equivalent write access); mutation fetches
   ICS, rewrites only my ATTENDEE line's PARTSTAT (targeted `editMasterVevent`-style
   replace like `ics.ts:244-251`), SEQUENCE+1, `updateEvent`; optimistic badge.

## Data model / types
- `Attendee` +3 optional params; stored JSON column `attendees`
  (`schema.ts:20`, `sync.ts:67`, `eventWrites.ts:33`) needs **no migration** —
  old rows lack the keys, parse as `undefined` = normal event. `rowKey`/
  `EVENT_OBSERVED_COLUMNS` already cover `attendees` so a status change refreshes UI.
- `Account.calendarUserAddresses?: string[]` (persisted store, additive).
- No `CalendarEvent` field: `isInvitation` is derived (`myPartstat` + me-set) to
  stay correct across account switches and organizer edge cases.

## Edge cases & error handling
- Organizer == me → never an invitation, even if an ATTENDEE matches my address.
- Attendee URI without `mailto:` (principal/`urn:uuid:`) → `readAttendees` keeps the
  raw value in `email`; match against `davUserId` slug and address-set hrefs.
- No `account.email` + no address-set (OCS restricted) → fall back to
  username/`davUserId`; worst case = no badge, no mislabelling.
- DECLINED: web hides declined events — out of scope; render normally, note in
  arbitration. `DELEGATED`/unknown PARTSTATs: treated as normal (whitelist match).
- Recurring: occurrences inherit master attendees already (`base` in
  `parseIcsItem`); per-occurrence ATTENDEE overrides flow through `exceptionFields`.
- `X-NC-PARTY-CRASHER` events (party-crasher invites): still show invitation style —
  server merely filters their REPLY.
- Read-only/subscribed calendars: display badge; phase-2 buttons hidden via
  `calendar.isReadOnly`.
- Address-set fetch failure → empty array, email/username matching only.

## Tests (jest / tsc / emulator)
- `__tests__/utils/caldav-parse.test.ts`: ATTENDEE with PARTSTAT/RSVP/ROLE params →
  captured; dedupe keeps partstat; exception VEVENT override replaces attendees.
- New `__tests__/features/event/participation.test.ts`: match by email (case-insensitive),
  username-as-email, `principals/users/<uid>` href, organizer exclusion,
  `calendarUserAddresses` aliases; unknown/missing PARTSTAT → `undefined`.
- `__tests__/api/caldav.test.ts`-style: `fetchCalendarUserAddressSet` parses multiple
  `d:href` (mailto:, principal, `urn:uuid:`), tolerates 403/empty.
- Phase 2: targeted PARTSTAT rewrite leaves other ATTENDEE lines byte-identical
  (fixture test against real NC invite ICS).
- `yarn tsc --noEmit` (or `npx tsc`); emulator vs NC+Mail: invite account B, sync →
  striped event + badge + detail banner; reply Accept → partstat ACCEPTED after sync.

## Docs & i18n
- Keys (×9 locale files under `src/locales/`): `event.invitationBadge`,
  `event.invitationFrom` ("Invitation from {name}"), `event.you`; phase 2:
  `event.accept`/`maybe`/`decline`/`responseSent`, error `event.errorReplyFailed`.
- Note in `nextcloud-feature-proposals.md` status column; mention on epic #251 +
  tracking #382. No README change (pure rendering parity).

## Open questions / arbitration notes
- Stripe vs dashed vs alpha fill: dashed border + transparent fill is the cheapest
  faithful port of the web's striped tentative style — confirm against web 6.6 CSS.
- Hide `PARTSTAT=DECLINED` like the web (setting?) or render normally? Proposed:
  render normally, revisit if users ask.
- Fetch `calendar-user-address-set` eagerly at login (in `validateCredentials`
  flow, one extra PROPFIND) or lazily on first invitation render? Proposed:
  lazily + persist — avoids slowing login.
- Phase 2 "Tentative" vs "Maybe" label; whether DECLINE should offer
  `x-nc-scheduling`-style silent decline — the server sends the REPLY on PUT, which
  is the desired behaviour (inviter must know).
- Should NEEDS-ACTION events also suppress local reminders until accepted?
  Proposed: keep alarms as-is (web does), revisit in #382.
