# A3 — Reply to invitations (PARTSTAT)
> Scope tag: [parity] | Effort: M | Targets: epic #251, PR #226 | Tracking: #382

## Goal & UX
On event detail (`app/event/[uid].tsx`), when the signed-in user is an ATTENDEE and not
the ORGANIZER, show a "My participation" card with Accept / Decline / Tentative. Action =
fetch the stored ICS, set only the user's own ATTENDEE `PARTSTAT=ACCEPTED|DECLINED|TENTATIVE`
(+`RSVP=FALSE`), PUT it back unchanged otherwise, let the server iTIP the organizer; patch
WatermelonDB optimistically. Web-parity baseline: series-level reply only; declined events
disappear from the grid (PR #226 semantics — verify against web 6.6: verify: whether web
keeps a declined event with a dimmed state vs removes it).

## Upstream dependencies & capability gating
- **Blocker (documented R2):** `attendeeLines` (`src/utils/ics.ts:95-100`, hardcoded line 98)
  rewrites every ATTENDEE to `CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;RSVP=TRUE;
  PARTSTAT=NEEDS-ACTION`, and `readAttendees` (`src/utils/caldav-parse.ts:59-72`) only reads
  `email`+`CN`. Without param round-trip, any edit after replying silently resets all reply
  states → iMIP re-mail spam. Fix first (part of this PR).
- PR #226 (`feature/caldav-invitations`) already ships most plumbing — this plan is largely
  "finish & harden", not greenfield: `src/services/nextcloud/invitations.ts`
  (`updateAttendeeStatus`, `respondToInvitation`, `findTargetAttendee`,
  `buildUpdatedCalendarIcs`, `buildReplyIcsFromRaw`), `useUpdateAttendeeStatus` hook,
  participation section in `app/event/[uid].tsx`, helpers in `src/utils/attendees.ts`.
- SEQUENCE: verify: RFC 5546 §3.2.3 — a REPLY carries the SEQUENCE of the REQUEST it
  answers → do **not** bump. Branch keeps raw SEQUENCE untouched in both builders ✓ —
  keep that, and document it next to `useMutateEvent.ts` which *does* `extractSequence+1`
  for organizer REQUEST updates (:287-305).
- No capability gate needed (plain CalDAV PUT). NC33 invitee restriction (server#57231)
  targets *adding* attendees, not own-PARTSTAT changes, but surface 403s via
  `describeMutationError` → `common.errorPermission` (`src/locales/en.json:7`).

## Implementation (files to touch/create, ordered steps)
1. `src/types/index.ts:28-31` — extend `Attendee`: `partstat?`, `rsvp?`, `role?`, `cutype?`,
   `delegatedTo?`/`delegatedFrom?`, `sentBy?`, `member?`, `scheduleAgent?`; keep `email`,
   `displayName`. (Branch only added `partstat`,`role` — widen it.)
2. `src/utils/caldav-parse.ts` `readAttendees` (:59) — read every listed param via
   `prop.getParameter(...)` (lowercased names), plus `exceptionFields` (:99-100) inherits it.
3. `src/utils/ics.ts` `attendeeLines` (:95-100) — emit stored params verbatim, defaults
   `CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION` only for freshly added
   attendees (`AttendeesField` pushes bare `{email}`/`{email,displayName}` :39). verify:
   quote param values containing `,;:` (CN quoting is missing today — pre-existing bug).
4. `src/utils/attendees.ts` — keep/merge branch helpers `isAttendeeOfAccount`,
   `findAttendeeForAccount`, `getAttendeePartstat`, `isCurrentUserAttendee`; add
   `isOrganizerOfAccount(event, account)` (compare `event.organizerEmail` to the resolved
   addresses below) so the section hides for the organizer.
5. Identity "which attendee is me": primary = `account.email` (OCS `fetchUserInfo`,
   `src/services/nextcloud/nextcloud.ts:34-53`; saved `auth.ts:70-72`; user-editable
   `features/account/utils/account.ts`). Improvement in scope: PROPFIND
   `C:calendar-user-address-set` on the principal (extend `validateCredentials`
   `caldav.ts:80-117` or a dedicated call at account refresh) → `Account.schedulingAddresses?:
   string[]`; fallback stays `username@` heuristic (`resolveOrganizer` pattern,
   `features/event/utils/organizer.ts:3-9`). verify: NC returns `mailto:` + `urn:uuid:` URIs.
6. `src/services/nextcloud/invitations.ts` (exists on branch) — `updateAttendeeStatus`:
   `fetchEventIcs` → ical.js round-trip (`parseIcsToJcal`, `masterVevent`,
   `updateAttendeePartstat`: `setParameter('partstat', …)` + `rsvp=FALSE`) → `updateEvent`
   PUT → return next `Attendee[]`. Keep raw-ICS patch (never `buildIcsForInput` — preserves
   all props SabreDAV tolerates; verify: NC allows attendee PUT that only changes own
   PARTSTAT — web relies on it). `useMutateEvent` update path needs no change once step 3
   lands (params ride through `input.attendees` from `EventForm` :89, :209).
7. UI `app/event/[uid].tsx` — participation card after attendees section (:348-364), gated
   `isCurrentUserAttendee(event, account) && !isOrganizer && !calendar?.isReadOnly &&
   !isSubscribed && !event.isTask`; current status label + 3 buttons highlighting active
   state (branch diff already does this; keep `readOnly` parity with `useCalendarData.ts:70`).
8. Local write — `useUpdateAttendeeStatus` (branch): on accept/tentative `patchByUid`
   (`eventWrites.ts:68`) `{attendees}` for `seriesBaseUid`; on decline branch currently
   DELETEs the resource + `removeWhere` — keep pending the open question below.
9. Grid affordance (B5 overlap, optional in this PR): `isEventPending`-style badge on
   `TimeGridEvent`/agenda rows — already on branch (`src/utils/eventPending.ts`); decide
   whether it ships here or with #226.

## Data model / types
- `Attendee` grows optional params (step 1). No WatermelonDB migration: `attendees` is a
  JSON string column (`schema.ts:20`, `sync.ts:67`, `eventWrites.ts:33`,
  `mappers/event.ts:9,19`) — new fields round-trip for free.
- `Account.schedulingAddresses?: string[]` if calendar-user-address-set lands (optional
  field, JSON column or in-memory on `Account` — verify where Account persists: not in DB).
- `InvitationResponse = 'accepted'|'declined'|'tentative'` (branch type, keep).

## Edge cases & error handling
- User is organizer → hide section (organizer can be listed as attendee; check both).
- No attendee matches my addresses → hide (don't guess on `username@` prefix collisions:
  `bob@a.com` vs `bob@b.com` both satisfy the heuristic — prefer exact-email match, fall
  back only when unambiguous).
- Read-only / subscribed / shared-no-write calendar, `isTask`, occurrence rows: hide or
  disable; reply is series-level anyway (all occurrences share `href` → one PUT covers all).
- Overrides: `updateAttendeePartstat` must scan *all* VEVENTs (master + overrides), not just
  master — verify: branch only patches `masterVevent`.
- PUT 403 (invitee restriction / ACL) → `describeMutationError`; PUT 412/409 → offer
  re-sync; outbox POST failures tolerated (403/404 logged, non-fatal — branch behaviour).
- verify: SabreDAV auto-schedules iMIP REPLY on attendee PUT (RFC 6638 server agent) — the
  branch's extra outbox POST may double-notify the organizer; the REPLY ICS it builds keeps
  *all* attendees while iTIP REPLY should carry only the replier — verify & strip.
- `dedupeAttendees` (`attendees.ts:3-27`) merges by email, keeps first — param precedence
  follows first occurrence; acceptable.

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/utils/ics.test.ts`: ATTENDEE round-trip — `buildIcs` re-emits stored
  PARTSTAT/RSVP/ROLE/CUTYPE/DELEGATED-*/quoted-CN; new attendee gets defaults.
- `__tests__/utils/caldav-parse.test.ts`: fixture with full param set → `Attendee` fields.
- `__tests__/utils/attendees.test.ts` (branch extends it): email match, username fallback,
  ambiguity, organizer guard.
- `__tests__/services/nextcloud/invitations.test.ts` (exists on branch, mocked fetch):
  assert PUT body has exactly one changed line (own PARTSTAT), SEQUENCE unchanged,
  METHOD removed; REPLY body contains only replier.
- `yarn tsc --noEmit`. Round-trip vs real NC: web-invite an account → app accept → web
  shows ACCEPTED + no duplicate mail; NC33 restricted instance → 403 message visible.

## Docs & i18n
- Keys (already on branch, absent on dev): `event.myParticipation`,
  `event.participation{Accepted,Tentative,Declined,NeedsAction}`,
  `invitations.{accept,decline,tentative,error,responseFailed}` — ×9 locale files in
  `src/locales/`.
- Update `nextcloud-feature-proposals.md` A3 status; note R2 fix ships in the same PR;
  comment in `ics.ts` explaining param preservation (prevents regression to NEEDS-ACTION).

## Open questions / arbitration notes
- Decline semantics: branch DELETEs the event; alternative = keep with `PARTSTAT=DECLINED`
  (web hides declined but keeps resource? verify). DELETE loses the ability to re-accept
  later — flag for review.
- Is the outbox REPLY POST needed at all, or redundant with SabreDAV auto-scheduling
  (double iMIP mail risk)? verify against server behaviour; drop if redundant.
- `calendar-user-address-set` fetch: in this PR (better identity) or follow-up? Recommended
  in — fixes ambiguous `username@` fallback.
- Ship scope: participation card only, or also the inbox screen/badge from #226? A3 alone
  does not require the inbox; grid "pending" styling can ride with B5.
- Per-occurrence reply (RECURRENCE-ID-scoped REPLY): out of scope — series-level matches
  web parity; note as future work.
