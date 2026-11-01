# B2 — Richer attendee availability (OOO + presence + restrictions)

> Scope tag: [upstream] | Effort: M | Targets: epic #254, issue #229, PRs #231/#310 | Tracking: #382

## Goal & UX

Extend find-time beyond raw free-busy with three server signals, shown next to each attendee:

1. **Out-of-Office (OOO)** — badge "Out of office until `<lastDay>`", optional replacement
   (`replacementUserDisplayName`), and the OOO day-range injected into the attendee's busy
   data as `BUSY-UNAVAILABLE` so suggestions avoid those days.
2. **Presence** — emoji + status dot (🟢 online / 🟡 away / 🔴 busy|dnd) and optional custom
   message from the `user_status` app, displayed on attendee rows (v1 sheet) / chips (v2 sheet)
   / lane headers (v2 explorer).
3. **Invitee restriction (NC33, server#57231)** — clear error when the server rejects an
   attendee on PUT (`403` + SabreDAV `<s:message>`) instead of today's generic
   `common.errorPermission` via `describeMutationError` (`src/services/shared/errors.ts:41`).

UI touchpoints (branch `feature/find-time-229` = PR #231): `FindTimeSheet.tsx` attendee rows
(~line 180-220, `availabilities.map`). Branch `feature/find-time-ux-v2` = PR #310:
`FindTimeSuggestSheet.tsx` attendee `Chip`s (~line 216-240) and `app/event/find-time.tsx` lane
rail (RAIL_WIDTH=96, lane labels ~line 130+). Optional: `AttendeesField.tsx` added-attendee rows
(`src/features/event/components/AttendeesField.tsx:100-118`).

## Upstream dependencies & capability gating

- **OOO**: `GET {base}/ocs/v2.php/apps/dav/api/v1/outOfOffice/{userId}` (upcoming|ongoing) or
  `/{userId}/now` (ongoing only). **Per-user endpoint** — spec's bare `/outOfOffice` is the base
  URL, not a list endpoint. Stable since NC28, in the always-on `dav` app. 404 = no absence.
- **Presence**: `GET {base}/ocs/v2.php/apps/user_status/api/v1/statuses/{userId}` (404 = unset);
  bulk `GET .../statuses` is paginated (limit/offset) — prefer per-user calls (N small).
  Gate on `capabilities.user_status` presence in the OCS capabilities response.
- Both take `userId`, but `Attendee`/`ShareeResult` carry only `email`. **verify**: capture the
  UID from autocompletion entries — `parseContactEntry` (`src/services/nextcloud/sharees.ts:54`)
  keeps `type==='individual'`, `source==='system'` marks instance users; check on a live NC
  whether the entry `id` is the UID. Fallback if absent: DAV `principal-property-search` REPORT
  on `{DAV:}email-address` → principal href (phase 2, flag "verify").
- Gating plumbing: `fetchCapabilities` → `fetchServerCaps` (`src/services/nextcloud/nextcloud.ts:79-99`)
  currently returns `{talkEnabled}` only. Extend to read `capabilities.user_status` and
  **verify** `ocs.data.version.major` for OOO≥28 — or simpler: probe once and cache "unsupported"
  per account in memory. Consume via `useAccountStore((s)=>s.capabilities)` (pattern: `TalkToggle.tsx:17`).

## Implementation (files to touch/create, ordered steps)

1. `src/services/nextcloud/userStatus.ts` **(new)** — `fetchUserPresence(account,userId)`,
   `fetchOutOfOffice(account,userId)`, `fetchAttendeeSignals(account,attendees)` →
   `Map<emailLower, AttendeeSignals>`; `trustedFetch` (`src/services/shared/trustedFetch.ts:139`)
   + `OCS-APIRequest:true` + `Accept:application/json`, `maxRetries:0` (best-effort); **verify**
   whether `/ocs/v2.php/...` needs the `index.php` fallback like `sharees.ts:29-34`.
2. `src/types/index.ts` — add `Attendee.userId?`, `UserPresence`, `OutOfOfficeInfo`,
   `AttendeeSignals`; `ServerCapabilities += userStatusEnabled: boolean`; optionally
   `AttendeeAvailability.unavailableReason?: 'no-data' | 'rejected'`.
3. `src/services/nextcloud/sharees.ts` — carry UID into `ShareeResult.userId` (verify field
   name); `AttendeesField.addAttendee` (line 30-41) passes `userId` into `Attendee`.
4. `src/services/nextcloud/nextcloud.ts` — extend `fetchServerCaps` → `userStatusEnabled`;
   default in `src/stores/accountStore.ts:17`.
5. `src/features/event/hooks/useAttendeeStatus.ts` **(new)** — same debounce/`activeRef` pattern
   as `useFreeBusy.ts`; keyed on `attendeeKey`; skip calls when no `userId` or capability off;
   short in-memory TTL (~5 min) — statuses change faster than the 1h `contactCache`.
6. `src/features/event/hooks/useFreeBusy.ts` — accept optional `extraBusy: Map<email,BusySlot[]>`
   and merge into `availabilities` before `mergeBusySlots` (line ~90-95); add `oooToBusySlots()`
   util (in `src/utils/freeBusy.ts`): `firstDay..lastDay` → all-day `BUSY-UNAVAILABLE`.
7. UI wiring: `FindTimeSheet.tsx` (v1 rows: dot + OOO line under name/email);
   `FindTimeSuggestSheet.tsx` (v2 chips: emoji/dot in `icon`, OOO sub-caption);
   `app/event/find-time.tsx` (lane rail labels + OOO merged into `a.slots` for `attendeeBlocks`,
   ~line 91-95). Pass `extraBusy` from `useAttendeeStatus` into `useFreeBusy` in all three.
8. Restriction surfacing: `putEvent`/`updateEvent` (`src/services/nextcloud/caldav.ts:419,439`)
   already read the error body — parse `<s:message>` and attach to `HttpError` (new
   `serverMessage?` field, `errors.ts:3-13`); `describeMutationError` → new branch: 403 +
   attendee-bearing event → `common.errorInviteRestricted` (fallback `errorPermission`). Also
   mark find-time attendees with non-2.x `request-status` (`freeBusy.ts` on branch,
   `fetchFreeBusy` ~line 145) as `unavailableReason:'rejected'` → UI "cannot be invited".
9. Rebase onto whichever find-time branch merges second (they conflict on the same files).

## Data model / types

```ts
type Attendee = { email: string; displayName?: string; userId?: string };
type PresenceStatus = 'online' | 'away' | 'busy' | 'dnd' | 'invisible' | 'offline';
type UserPresence = { status: PresenceStatus; icon?: string; message?: string; clearAt?: number };
type OutOfOfficeInfo = { userId: string; firstDay: string; lastDay: string;
  shortMessage?: string; message?: string;
  replacementUserId?: string; replacementUserDisplayName?: string };
type AttendeeSignals = { userId?: string; presence?: UserPresence | null;
  outOfOffice?: OutOfOfficeInfo | null };
```

`ServerCapabilities` adds `userStatusEnabled: boolean` (default `false`). OCS responses read
`json.ocs.data`; per-user 404 → `null` (absence unset / status unset), network error → `null`.

## Edge cases & error handling

- Attendee without `userId` (typed email, `source:'user'` contact, federated, room/resource) →
  no badge, no fetch. **verify**: `type` values for rooms/resources are dropped today anyway.
- OOO `firstDay`/`lastDay` are `YYYY-MM-DD` in the *absentee's* tz (unknown) → treat as whole
  server-local days; flag in code comment.
- OCS JSON vs XML: always send `Accept: application/json`; some servers still return XML on
  errors — guard `res.json()` with try/catch.
- Bulk alternative `/statuses` is paginated and unfiltered → don't use it.
- PUT-403 body may be localized (`<s:message>`) → match loosely or show raw message appended.
- Rate: 2 requests/attendee/sheet-open; `Promise.allSettled`, never block free-busy render.
- Offline/server <28 → all signals `null`, UI identical to today (progressive enhancement).

## Tests (jest / tsc / caldav round-trip / emulator)

- `__tests__/services/nextcloud/userStatus.test.ts` **(new)**: OOO 200/404, presence 200/404,
  OCS JSON shape, `fetchAttendeeSignals` email-keyed map, error→null.
- Extend `__tests__/services/nextcloud/sharees.test.ts`: `userId` captured for `source:'system'`.
- Extend `__tests__/utils/freeBusy.test.ts`: `oooToBusySlots` single/multi-day → BUSY-UNAVAILABLE.
- Extend `__tests__/features/event/useFreeBusy.test.ts`: `extraBusy` merge removes OOO days from
  `suggestions`; `request-status` non-2.x → `unavailableReason:'rejected'` (branch file).
- `describeMutationError` test: 403 + `<s:message>` invite text → `errorInviteRestricted`.
- `tsc --noEmit`; jest suite. Emulator: `find-time-scenario.md` — OOO contact + presence dot +
  restricted-attendee save error toast (needs a real NC33+ instance with the admin restriction).

## Docs & i18n

- 9 locale files (`src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`): keys
  `event.findTimeOoo` ("Out of office"), `findTimeOooUntil`, `findTimeOooReplacement`,
  `findTimePresence{Online,Away,Busy,Offline}`, `findTimeNotInvitable`, `common.errorInviteRestricted`.
- `README.md` + `USER_GUIDE.md` find-time section (both branches already update it); new GIF if
  v2 lands (`docs/*mockups` precedent); note "requires NC28+ / user_status app".

## Open questions / arbitration notes

- **verify**: autocompletion entry `id` = UID? Decides whether typed emails ever get signals
  (fallback = principal-property-search, extra M effort — propose deferring).
- **verify**: NC33 restriction actually rejects at PUT (403) vs inside schedule-response
  `request-status` — plan covers both paths.
- **verify**: exact `user_status` capability shape (`enabled` flag? presence of key only).
- OOO → busy-block injection assumes OOO = unavailable for the whole range; the API's
  `/{userId}/now` variant only covers today — use `/{userId}` for the 15-day suggestion window.
- Should OOO also show *inside* the attendee picker (`AttendeesField` rows)? Proposal: yes for
  added attendees, no for the suggestion dropdown (too many calls) — arbitrate in #382.
- v1 vs v2: implement once both PRs settle; if both stay open, land on the one merging first.
