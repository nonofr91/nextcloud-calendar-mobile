# D4 — Offline mode + mutation queue
> Scope tag: [mobile+/reliability] | Effort: L | Targets: epic #286 | Tracking: #383

## Goal & UX
Today every mutation PUT/DELETEs immediately (`useMutateEvent.ts` → `putEvent`/`updateEvent`/`moveEvent`/`deleteEvent`, `src/services/nextcloud/caldav.ts:419-480`); offline, the optimistic local write is rolled back and an Alert fires (`useMutateEvent.ts:220-222, 335-336, 373-374`). Goal: mutations (create / update / delete / move-calendar / drag-move; PARTSTAT reply once A3 lands) apply locally and are enqueued; an "unsynced" badge marks pending events; replay is FIFO on reconnect or next sync; remote changes → conflict surfaced to the user (keep-mine vs use-server — recommended over silent server-wins). Behavior change: e2e `offline/create-offline.yaml` currently asserts create FAILS in airplane mode.

## Upstream dependencies & capability gating
- No server capability needed — plain CalDAV semantics; NC35 `no-uid-conflict` (server#61659) improves double-PUT detection but is not required.
- Online detection already exists: `src/services/shared/network.ts` (`expo-network` — `setupOnlineManager` wired at `useAppInitialization.ts:32`, `getIsOnline`, `useIsOnline`) + `OfflineBanner.tsx`. No `@react-native-community/netinfo` in package.json — none needed (verified).
- Related branches (both stale — diffs show they predate schema v8/v9, dev is v9; verify rebase): `fix/sync-persist-local-write-epoch` (PR #217 → MMKV-persisted `localWriteEpoch`, `src/database/localWriteEpoch.ts`) and `fix/sync-retry-on-failure` (PR #312 → `{failedCount}`, `SyncErrorBanner`, `useIsOnline`-driven resync in `useCalendarData`). Land D4 after #312: its reconnect hook becomes a flush trigger. `localWriteEpoch` guard stays — queue rows additionally need the `pending_sync` flag so sync can't clobber optimistic rows outside the epoch window.

## Implementation (files to touch/create, ordered steps)
0. Refactor `src/features/event/hooks/useMutateEvent.ts`: extract remote-apply blocks (create :209-218, update :263-333, delete :359-371) into pure async `applyCreate/applyUpdate/applyDelete` in new `src/services/sync/mutationRunner.ts`, shared by hook (online path) and queue worker.
1. Schema v10 (`src/database/schema.ts:4`): new `mutations` table + `pending_sync` bool on `events`; `toVersion: 10` migration (`createTable` + `addColumns`, `src/database/migrations.ts`); new `src/database/models/Mutation.ts`; register in `src/database/index.ts` `modelClasses`; add `pending_sync` to `EVENT_OBSERVED_COLUMNS`, `rowKey` fingerprint (`useEvents.ts:11-34`), `mapEventToShared`, `CalendarEvent.pendingSync` (`src/types/index.ts`).
2. New `src/database/mutationQueue.ts`: `enqueue` inside the same `safeWrite` as the optimistic write in `eventWrites.ts` (atomic), `pendingOps(accountId)` FIFO, `markStepDone/markFailed/markConflict`, coalescing (update+update→merge; update+delete→delete only; create+delete→annihilate, no remote call).
3. New `src/services/sync/queueWorker.ts` `flushQueue(account)`: replay FIFO; rebuild remote payloads at replay (datesOnly/scope-edits re-fetch master ICS like the hook does at :270/:288/:313/:326/:365 — store intent, not final ICS); per-step `steps_state` for crash-resume idempotency; transient (network/timeout/5xx/429 + `HttpError.retryAfter`) → backoff, stay pending; permanent 4xx → `failed` + notify.
4. Triggers: `getIsOnline()` gate before remote attempt (fail-fast → enqueue instead of Alert); flush on online transition (reuse PR #312 `prevOnlineRef`/`retryNonce` pattern in `useCalendarData`), before `syncVisibleRange` per account (`src/database/sync.ts:270`), and on app foreground (`useAppInitialization`).
5. Hooks: replace catch→rollback→Alert with enqueue (+ immediate flush attempt when online); keep rollback only for validation errors.
6. Conflict detect: before replaying update/delete, `fetchEventIcs` (`caldav.ts:410`) and compare SEQUENCE/DTSTAMP vs enqueue-time snapshot → changed remotely ⇒ `conflict` op → banner + per-event action. Note: etags are requested in REPORTs but never parsed (verify: `reportCalendarObjects` keeps only href+calendar-data, caldav.ts:311-317); persisting `etag` on events is optional hardening.
7. UI: pending badge on event chips (verify exact components: `MonthDayView`, grid `toGridEvents` consumers) + pending/conflict rows in `app/event/[uid].tsx`; failed ops listed near `SyncErrorBanner` (#312) or a settings "Sync status" row.
8. `ClearDatabaseForAccount` (`DatabaseProvider.tsx:19-32`): add `mutations` to `tablesWithAccount`.

## Data model / types
- `mutations`: `account_id` idx, `calendar_id`, `uid` idx (series base uid), `href`, `kind` (`create|update|delete|move|partstat`), `payload` JSON (CreateEventInput + scope + datesOnly + snapshot refs), `steps_state` JSON, `status` (`pending|inflight|conflict|failed`), `attempts`, `last_error`, `created_at`, `updated_at`.
- `events.pending_sync` boolean set atomically at enqueue, cleared on flush success; `CalendarEvent.pendingSync?: boolean`; `MutationOp` union type.
- Idempotency: deterministic href `${calendar.url}${uid}.ics` (already, `useMutateEvent.ts:160`) → re-PUT safe; DELETE already tolerates 404 (`caldav.ts:478`); MOVE replay must treat "source 404 + destination exists" as done (verify: `moveEvent` Overwrite:T, `caldav.ts:455-471`).
- Ordering: `syncEvents`/`syncCalendarDelta` must skip `pending_sync` rows in `writeEvent`/`deleteMissing` paths (`sync.ts:233-255, 388-404`); flush runs before the delta application for the account so queued PUTs precede incoming sync of the same UID.

## Edge cases & error handling
- Compound ops: update+calendar-change = `updateEvent`+`moveEvent` (`:305-310`); `thisAndFollowing` = truncate+`putEvent` (`:328-332`) → one queue row, ordered steps, resume via `steps_state`.
- Crash mid-flush: `inflight` rows older than a watchdog window → requeue, resume at first non-done step.
- 401 → pause queue + auth error; 403 (privilege revocation, NC33 invitee restriction) / 404 / 409-412 (`no-uid-conflict`) → `failed`, notify, never loop.
- Conflict policy per spec: surface to user — server-wins silently drops edits; keep-local blindly on attendee events re-sends iMIP mail (risk R2 in impact analysis).
- Local reminders: pending-create alarms may fire pre-sync; pending-delete must cancel scheduled alerts (verify `src/features/notifications/scheduleAlerts.ts`).
- Multi-account: flush only active account (offline edits only possible there anyway).
- Recurrence scope edits offline need master ICS at flush → if fetch fails non-transiently, mark conflict/failed rather than replaying stale.

## Tests (jest / tsc / emulator — airplane-mode scenarios)
- jest new: `__tests__/database/mutationQueue.test.ts` (enqueue/coalesce/annihilation/FIFO), `__tests__/services/queueWorker.test.ts` (replay order, steps_state resume, transient-vs-permanent mapping, conflict on bumped SEQUENCE, pending_sync skipped by `syncEvents`/`syncCalendarDelta`); extend `useEvents.test.ts` fingerprint cases.
- `yarn tsc --noEmit` + existing suites (additive changes).
- e2e/maestro: rewrite `e2e/maestro/offline/create-offline.yaml` → create in airplane shows pending chip; disable → assert synced + badge clears; add edit-offline / delete-offline / drag-offline; `server-down.yaml` unchanged. Emulator: airplane-mode series edit "this and following", kill-app mid-flush restart resume.

## Docs & i18n
- USER_GUIDE.md "Offline mode & sync" section (badge meaning, replay, conflict resolution); note the behavior change vs old fail-fast offline create.
- New keys in all 9 `src/locales/*.json` (de en es fr it nl oc pt ru): `event.pendingSync`, conflict + failed-op strings, banner copy — follow `calendar.offlineBanner`/`event.errorCreateFailed` conventions (verified).

## Open questions / arbitration notes
- Scope tag: spec says [mobile+/reliability]; epic #286 already has thread #7 "Offline write queue & conflict resolution" (discussioncomment-18572163) — verify it needs #383 tracking vs a dedicated issue.
- Conflict policy is the main arbitration: surface (recommended) vs server-wins-with-notice vs keep-local.
- Build order vs PR #217/#312: both are prerequisites-adjacent and stale; decide whether D4 rebases them or reimplements persisted epoch.
- v1 scope: all mutation paths incl. series-scope edits (needs replay-time master fetch) vs create/update/delete-simple first — recommend full scope, degrade to conflict on fetch failure.
- Payload as JSON blob (recommended) vs normalized columns; badge styling needs a UX pass (mockup).
