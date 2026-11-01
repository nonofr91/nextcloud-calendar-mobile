# A8 — Delegation & federated-share visibility
> Scope tag: [parity] | Effort: S | Targets: epic #250 | Tracking: #382

## Goal & UX
Delegated calendars already work end-to-end (NC35 grants the delegate ACLs →
`current-user-privilege-set` may contain `write` → `isReadOnly` false → events writable;
`owner-principal` ≠ `davUserId` → `isShared` → "SHARED CALENDARS" drawer group).
Remaining gaps are read/UX only:
- (a) Show **who** shared/delegated: subtitle "Shared by X" on shared rows
  (`CalendarDrawerRow` `Item` already supports `description`, `src/ui/components/Item.tsx:8`).
  `owner-principal` is currently parsed but discarded (caldav.ts:220-221).
- (b) Surface **pending shares** (NC35 server#63112: federated shares may await
  accept/decline). If PROPFIND exposes pending invitations, list them as inert
  "Pending invitation" entries; otherwise document "a missing federated calendar is
  not a bug — accept it on the web first". Accept/decline stays web-only in v1.
- (c) Owner-only resharing (NC35 server#65300): no share UI exists; requirement is a
  documented 403-mapping rule for when epic #250 adds sharing.

## Upstream dependencies & capability gating
- No version gate needed: all fields are optional PROPFIND props; absent ⇒ feature off.
- verify: pending-invite wire shape on a live NC35 — candidate prop `{http://sabredav.org/ns}invite`
  (SabreDAV resource-sharing) or `{http://calendarserver.org/ns}invite` on non-calendar
  responses inside the same calendar-home PROPFIND, carrying `invite-status`
  (noresponse/accepted/declined) + `share-access` + organizer href.
- verify: whether **federated** pending shares appear there at all; NC35 may instead route
  them through notification-center action links — then nothing is client-visible and the
  fallback is documentation (+ optional hint row, arbitrate).
- verify: federated `owner-principal` value (`principals/users/<federated-id>` vs
  `principals/federated/…`) and whether Depth:0 PROPFIND `displayname` works on it.
- 403 on share/reshare is already mapped to `common.errorPermission`
  (`src/services/shared/errors.ts:47-48`); dedicated wording deferred to the share feature.

## Implementation (files to touch/create, ordered steps)
1. `src/services/nextcloud/caldav.ts` `fetchCalendars`:
   - Capture `ownerPrincipal` (raw href/text already matched at :220, keep
     `absUrl(account, …)`-usable form).
   - Add `<cs:invite/>` to the PROPFIND prop list (and a second xmlns candidate pending
     the namespace verification); parse non-calendar responses carrying
     `invite-status = *noresponse*` into placeholder metas:
     `{ isShared:true, sharePending:true, isReadOnly:true, supportsEvents:false }`.
   - New `resolvePrincipalDisplayNames(account, hrefs)`: unique `ownerPrincipal` hrefs →
     Depth:0 PROPFIND `<d:displayname/>` via `absUrl` + `davFetch`, `Promise.all`,
     errors swallowed → `undefined`. Wire into `fetchCalendars` for `isShared` calendars
     only; fallback label = `extractSlug(ownerPrincipal)` (URI tail, often the uid or
     `user@remote.tld`). verify request cost — calendars are few; still cap/parallelize.
2. `src/types/index.ts:12-26` `CalendarMeta`: `ownerPrincipal?: string`,
   `ownerDisplayName?: string`, `sharePending?: boolean`.
3. WatermelonDB (schema v10, mirrors the `is_shared` v9 pattern):
   `src/database/schema.ts` version→10 + 3 optional `calendars` columns
   (`owner_principal`, `owner_display_name`, `share_pending`);
   `src/database/migrations.ts` `toVersion:10` `addColumns`;
   `src/database/models/Calendar.ts` fields; `src/database/sync.ts` `writeCalendar`
   (34-48) + `calendarUnchanged` (78-92); `src/database/useCalendars.ts`
   `mapCalendarToMeta` (11-27); `src/database/observedColumns.ts`
   `CALENDAR_OBSERVED_COLUMNS` (21-33).
4. `src/database/sync.ts`: exclude `sharePending` rows from event sync (same skip class
   as `c.isSubscribed` at ~:287) so no REPORT is issued on a not-yet-accepted share.
5. `src/features/calendar/components/CalendarDrawerRow.tsx`: `description` =
   `t('calendar.sharedBy', { name: ownerDisplayName ?? tail })` when `isShared`;
   `t('calendar.sharePending')` when `sharePending` (and disable/keep the toggles —
   pending rows get no bell).
6. `src/utils/calendars.ts`: `calendarGroup` already routes `isShared`→'shared' (pending
   inherits it); ensure `isWritableCalendar` stays false for pending (readOnly covers it).
7. Docs: note the 403/owner-only rule in epic #250 discussion thread for the future
   share feature; i18n key `calendar.shareNotOwner` optional until then.

## Data model / types
- `CalendarMeta`: +`ownerPrincipal` (principal URI as returned, may be relative),
  +`ownerDisplayName` (best-effort resolved), +`sharePending` (invitation awaiting
  accept). All optional — no breaking change; older servers simply never set them.
- Pending shares are stored like normal calendar rows so they survive syncs and render
  through the existing drawer pipeline; they are excluded from event sync (step 4).

## Edge cases & error handling
- `owner-principal` may be empty, self (→`isShared` false), an absolute URL, or a
  principal without a resolvable displayname (403 on principal PROPFIND, remote
  principal) → always fall back to `extractSlug` tail.
- Displayname resolution is best-effort: swallow per-principal failures, never fail
  `fetchCalendars`; dedupe principals before fetching.
- Invite prop absent (most servers) → `sharePending` never set → zero UI change.
- After web-side acceptance the next `syncCalendars` turns the placeholder into a real
  calendar (same collection id/URL → row updated via `calendarUnchanged` path); after
  decline it disappears via the existing `removed`/`prepareMarkAsDeleted` path (sync.ts:136-147).
- Reshare attempt 403 (future share UI): keep `describeMutationError` 403 mapping;
  distinguish "not owner" via a dedicated i18n message, not a new error class.

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/api/caldav.test.ts` (fetch mock, `propfind` fixture :264-279): owner href
  → `ownerPrincipal`/`ownerDisplayName` populated; 403 on principal PROPFIND → tail
  fallback; invite response → `sharePending` meta; self-owner still `isShared:false`.
- `__tests__/database/syncCalendars.test.ts`: new fields persist; `calendarUnchanged`
  reacts to owner/displayname drift; pending rows excluded from event sync.
- `__tests__/utils/calendars.test.ts`: pending calendar groups to 'shared', not writable.
- `yarn tsc --noEmit`; migration v9→v10 smoke (fresh install + upgrade).
- Emulator vs real NC32/35: user-delegated calendar (writable, "Shared by X"),
  federated share before/after web acceptance — confirms the pending visibility question.

## Docs & i18n
- Keys (×9 locales `src/locales/*.json`, follow `calendar.*`): `calendar.sharedBy`
  ("Shared by {{name}}"), `calendar.sharePending` ("Pending — accept on Nextcloud web");
  `calendar.shareNotOwner` only when sharing lands.
- Update `nextcloud-feature-proposals.md` (A8 status) + user docs (#258): delegated
  calendars appear under Shared; federated shares pending acceptance may be invisible
  until accepted on the web.

## Open questions / arbitration notes
- Exact pending-invite prop/namespace and whether NC35 federated pendings appear in
  PROPFIND at all — decide "indicator" vs "documentation only" after one live check.
- Display-name resolution adds N Depth:0 PROPFINDs per sync; if that regresses cold
  start, drop to URI-tail-only (smaller S) or lazy-resolve on drawer open.
- Federated owner principal format unverified — tail fallback must remain meaningful.
- Effort refines to S+ if principal-displayname resolution is kept; pure URI-tail
  + pending flag is a solid S. Accept/decline in-app is a later, separate feature.
