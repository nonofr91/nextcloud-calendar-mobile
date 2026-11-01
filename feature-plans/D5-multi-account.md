# D5 — Unified multi-account agenda
> Scope tag: [mobile+] | Effort: L | Targets: issue #311, discussion #304 | Tracking: #383

## Goal & UX
Aggregate calendars of **all configured Nextcloud accounts** in one agenda (month /
week / 3-days / day / schedule), instead of today's single-active-account switcher.
- Verified current state: multi-account **storage** exists (SecureStore per account,
  `src/services/nextcloud/auth.ts:22-41`, `account_ids` list, `useAccounts`,
  `src/hooks/useAccounts.ts:28`; add flow `app/(tabs)/settings/accounts.tsx:40` →
  `/(auth)/setup`; `AccountSwitcher` in `CalendarDrawer.tsx:79`). But **views are
  single-account**: `activeAccountId` (`src/stores/accountStore.ts:7`) feeds
  `useEventsForRange(activeAccountId)` and `syncVisibleRange(activeAccount)`
  (`src/features/calendar/hooks/useCalendarData.ts:16-49`).
- Target UX: `CalendarDrawer` groups calendars per account (avatar + displayName +
  host header), account filter chips ("All" / per account) — filter persists;
  per-account accent badge on drawer rows and a subtle account dot on event blocks
  when >1 account is visible; event detail shows "Account: X". `activeAccountId`
  is kept but redefined as **default account** for new-event creation.

## Upstream dependencies & capability gating
- No server feature needed — pure client aggregation over existing CalDAV paths.
- Cross-ref: NC35 delegated/federated **writable** calendars already land as
  `isShared` per account (`caldav.ts:220-233`, analysis §2, plan A8) — covers part
  of "see a colleague's calendar" *within one login*; D5 remains needed for
  separate credentials/servers (#304).
- verify: push POC (branch #230) needs per-account registration — follow-up, not
  a blocker. Search PR #296 not merged (no `src/features/search`) — when it
  lands, scope queries per visible account.

## Implementation (files to touch/create, ordered steps)
1. `src/stores/calendarStore.ts`: add persisted `hiddenAccountIds: string[]` +
   `toggleAccountVisibility` (mirror `hiddenCalendarIds` pattern, :9/:36-37).
2. `src/stores/accountStore.ts`: `capabilities` → `capabilitiesByAccount:
   Record<string, ServerCapabilities>` (single slot today, :8/:17/:19); update
   consumers: `useCapabilitiesSync.ts`, `useAppInitialization.ts:80-86`,
   `useWidgetSync.ts:19`, `app/(tabs)/calendar/index.tsx:42` (`unconfigured`
   check becomes "all visible accounts unconfigured").
3. `src/database/useEvents.ts`: widen `useEventsForRange(accountId: string)` to
   `accountIds: string[]` (`Q.where('account_id', Q.oneOf(ids))`, :52-56) or add
   sibling hook; same for `useCalendarsFromDb` (`useCalendars.ts:29-47`) →
   `Q.oneOf`.
4. `src/hooks/useCalendars.ts`: new `useAllCalendars(accounts)` — DB query across
   accounts + staggered `syncCalendars(account)` per account (existing 30 s poll,
   :7/:19; settle per account, keep per-account `isFetching` map).
5. `src/features/calendar/hooks/useCalendarData.ts`: rewrite — visible accounts =
   `useAccounts()` minus `hiddenAccountIds`; merged calendars (each `CalendarMeta`
   already carries `accountId`, `types/index.ts:14`); fan out
   `syncVisibleRange(account, calsOfThatAccount, range)` per account via
   `settleAll` (`src/utils/settle.ts`, already used `sync.ts:293`); events from
   the widened range query; keep `hiddenCalendarIds` filter (:68) — ids are full
   URLs (`caldav.ts:247` `id: calFullUrl`) so collision-free across accounts.
6. Event identity in routes: `uid` is **not** unique across accounts — canonical
   key is `eventKey(accountId, calendarId, uid)` (`sync.ts:21`). Add `account`
   param: `router.push('/event/${uid}?account=${event.accountId}')` at
   `app/(tabs)/calendar/index.tsx:80,85` (+ AgendaView/MonthDayView paths);
   `app/event/[uid].tsx:55` and `app/event/edit/[uid].tsx:31` resolve account
   from param; fallback when absent: query all accounts by uid, first match.
7. Mutations resolve the **event's own** account: `app/(tabs)/calendar/index.tsx`
   `handleMoveEvent` (:107-127) and both event screens must look up
   `accounts.find(a => a.id === event.accountId)` instead of `activeAccount`;
   `useUpdateEvent`/`useDeleteEvent` already take `account` (`useMutateEvent.ts`).
   `openTalkRoom.ts` uses `activeAccountId` — switch to event's account.
8. Creation: `app/event/new.tsx` + `EventForm` — calendar picker lists writable
   calendars of all accounts grouped by account label; target account =
   `calendar.accountId`; default stays `defaultCalendarByAccount[activeAccountId]`
   (`settingsStore.ts:23` already per-account).
9. `CalendarDrawer.tsx`: replace `AccountSwitcher` single-select by "All accounts"
   + per-account section headers (avatar/name/host, reuse `AccountCard` style);
   inside each account keep `CALENDAR_GROUPS` (:124-144); row badge = account
   color dot only when accounts share identical calendar names (verify need).
   `CalendarTopBar` optionally hosts filter chips.
10. Notifications: `readEvents.ts` `eventsInRangeQuery(accountId)` (:19-27) →
    multi-account variant; `readUpcomingEvents`/`observeTodayEventsQuery`
    aggregate visible accounts; `scheduleAlerts.ts:73` notification `data` gets
    `accountId` for the deep link; `useEventAlerts.ts:23` per visible account.
11. Widgets: `useWidgetSync.ts:52` `observeAgendaEventsQuery(activeAccountId)` →
    all visible accounts; `WidgetCalendarSettings.tsx` rows get an account label;
    `backgroundSync.ts` per-account loop.
12. `useAppInitialization.ts:55-87` + `useCapabilitiesSync.ts`: `syncCalendars` /
    `fetchCapabilities` for **every** account (settleAll), into
    `capabilitiesByAccount`.
13. `app/(tabs)/settings/account/[id].tsx`: add "Show in unified agenda" toggle
    (drives `hiddenAccountIds`); `accounts.tsx` unchanged otherwise.
14. `app/(auth)/setup.tsx:83-95`: warn on duplicate `baseUrl`+`username` (today a
    random UUID is always created — no dedupe, verified).

## Data model / types
- **No WatermelonDB migration**: `events.account_id` and `calendars.account_id`
  are already indexed (`schema.ts:9,34`, v9); sync tokens are per-calendar rows
  (`sync_token`, :44) hence per-account; `deltaKey` already includes `account.id`
  (`sync.ts:264`). `ClearDatabaseForAccount` wipes per account on delete
  (`useMutateAccount.ts:65`, `DatabaseProvider.tsx`).
- `Account`/`CalendarMeta`/`CalendarEvent` types unchanged (`accountId` fields
  already present, `types/index.ts:14,55`).
- Store changes only: `hiddenAccountIds`, `capabilitiesByAccount` (persisted;
  add migrate for old `capabilities` shape).

## Edge cases & error handling
- UID collisions across accounts (same holiday ICS on two servers): all lookups
  keyed by `accountId|uid`; routes must carry `account`, else first-match fallback.
- One account failing/offline: per-account `settleAll` isolation — merged view
  keeps other accounts' cached events; surface a per-account error badge
  (`useAccountAuthStatus` exists per account, `settings/account/[id].tsx:34`) —
  e.g. `AccountIssueBanner` listing the failing account + reconnect link.
- `localWriteEpoch` is global (`sync.ts:156-164`): a local write during another
  account's `safeWrite` cancels that batch (`:208/:220`) — conservative-correct,
  next poll resyncs; document, no change.
- Capabilities differ per server (Talk on A not B): create/edit/Talk-open must
  read `capabilitiesByAccount[event.accountId]` — never the active one.
- `account.timezone` differs per account: `resolveTimezone(account)` already
  takes the account (`useMutateEvent.ts:185`) — pass event's account.
- Account deleted: rows wiped (`ClearDatabaseForAccount`); stale ids in the
  hidden* lists are harmless (URL/UUID-keyed) — prune `hiddenAccountIds` in
  `useDeleteAccount`.
- Privacy: work events in personal widget/notifications — per-account "include
  in widgets / notifications" flags if arbitrated (else visibility governs).

## Tests (jest / tsc / emulator)
- jest: multi-account query helpers (`__tests__/database/useEvents.test.ts`),
  `useCalendarData` merge + `readOnly` propagation
  (`__tests__/features/calendar/useCalendarData.test.tsx`), `hiddenAccountIds`
  filtering, `capabilitiesByAccount` resolution in EventForm Talk toggle,
  delete-account keeps other accounts' rows (`syncCalendars.test.ts` pattern),
  notification scheduler aggregation (`scheduleAlerts` on 2 accounts).
- `yarn tsc --noEmit`.
- Emulator/manual: two accounts (two NC instances or two users same server) —
  merged month/week/agenda, chips filter, account badge, event of account B opens
  detail and edits with B's credentials, Talk only when B's caps allow, alerts +
  widget from both, delete A leaves B intact, offline A doesn't blank B.

## Docs & i18n
- Keys (×9 locales `src/locales/*.json`): `calendar.allAccounts`,
  `calendar.accountFilter`, `event.accountLabel`, `settings.account.showInAgenda`,
  `settings.account.includeInWidgets` (if added), `accounts.syncError`.
- User docs (#258): behavior change — switcher becomes unified view; explain
  default-account-for-creation; note delegated/federated alternative (A8) for
  same-server colleagues.

## Open questions / arbitration notes
- **Default-account model**: keep `activeAccountId` as creation default
  (recommended — minimal disruption) vs fully account-less UI where the calendar
  picker alone decides. Arbitration needed — it shapes `AccountSwitcher` fate.
- Widgets/notifications scope: all visible accounts vs per-account opt-in flags
  (privacy favors opt-in; cost = 2 more settings).
- Sync fan-out parallel (`settleAll`, recommended — functions already per-account
  isolated) vs sequential on battery/metered connections.
- Biggest surprise: DB already fully account-scoped — work is view/orchestration/
  routing, not schema migration. Effort stays **L**; risk drops to "plumbing".
- verify: `useContactSuggestions`/sharees autocompletion account binding when an
  event of account B is edited while A is active.
