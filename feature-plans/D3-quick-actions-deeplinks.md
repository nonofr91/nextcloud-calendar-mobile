# D3 — System quick actions & deep links
> Scope tag: [mobile+] | Effort: M | Targets: issue #374, related #95/#224 | Tracking: #383

## Goal & UX
Three entry surfaces, one routing core:
- **(a) Android "create event" intent**: app appears in OS targets for `INSERT` on `vnd.android.cursor.item/event` (assistants, other apps, "add to calendar" links) → opens the new-event form prefilled with title/location/dates/description.
- **(b) .ics share target**: opening/sharing an `.ics` (mail attachment, Files, browser download) routes into the import flow — *already implemented* on `feature/ics-file-import-95`; D3 closes gaps (ACTION_SEND, http(s) .ics) or documents them.
- **(c) Universal deep links**: `nextcloud-calendar://event/<uid>` opens event detail — *already functional* (`scheme` in `app.config.ts:24` + route `app/event/[uid].tsx`; widgets already emit it via `eventDeepLink()`, `src/features/widget/core/types.ts:62`, consumed at `homeWidget.android.tsx:38` / `homeWidget.ios.tsx:72`). D3 hardens it: notification-tap → event, unknown/foreign-account UIDs, optional `?date=` day view.
- iOS: scheme links + .ics document type only; no OS "create event" intent exists; Universal Links not feasible (see gating).

## Upstream dependencies & capability gating
- **(b) depends on PR #224** (`feature/ics-file-import-95`): `app/+native-intent.ts`, `app/event/import.tsx`, `IcsImportScreen`, `useImportIcs`, `readIcsUri`, `intentFilters` + `CFBundleDocumentTypes` in `app.config.ts`, `expo-file-system` dep. Land #224 first or rebase D3 on it.
- No server capability gating — all surfaces are client-side.
- Android INSERT extras (`title`, `beginTime`, `endTime`, `eventLocation`, `description`, `allDay`, `rrule`) are Intent extras, **not** in the URI → `redirectSystemPath` alone cannot prefill; needs a tiny native reader or graceful degradation.
- Universal Links / App Links (`autoVerify` + `assetlinks.json`, iOS `associatedDomains` + AASA) require a domain we control; users connect to arbitrary Nextcloud hosts → **scheme-only**; document as caveat.

## Implementation (files to touch/create, ordered steps)
1. `app.config.ts` `android.intentFilters` (array starts on the ics branch at :81 — merge into it; on dev it doesn't exist): add `{action:'INSERT', category:['DEFAULT'], data:{mimeType:'vnd.android.cursor.item/event'}}`. Do NOT add `EDIT`/`VIEW` on `vnd.android.cursor.item/event` — `content://com.android.calendar/events/<id>` URIs carry CalendarContract ids we cannot resolve.
2. Regenerate `android/app/src/main/AndroidManifest.xml` via prebuild (existing scheme filter at :29-35 stays); verify no hand-edits needed.
3. `app/+native-intent.ts` (extend the #224 version — file does not exist on dev): besides the existing `content://`/`file://*.ics → /event/import?uri=` rules, add `content://com.android.calendar*` (INSERT data URI) → `/event/new?intent=insert`; keep `nextcloud-calendar://*` passthrough; keep dropping non-.ics `file://`.
4. `modules/intent-extras/` — new local Expo module (precedent: `modules/tls-trust`, `modules/zxing-scanner`): `getInitialIntentExtras()` (cold start) + event emitter on `MainActivity.onNewIntent` (activity is `singleTask`, manifest :24); parse the extras whitelist above. Fallback if module is rejected: redirect lands on `/event/new` unprefilled (acceptable v1).
5. `app/event/new.tsx`: accept route params `title|description|location|start|end|allDay|rrule` in addition to `date` (:18) → map to `EventForm`'s existing `initialValues` prop (`EventForm.tsx:22-41,66-91` already supports summary/dtstart/dtend/allDay/description/location/attendees/rrule/alarms).
6. `src/features/notifications/useNotificationResponse.ts` (new): `Notifications.addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync` → `router.push('/event/'+uid)` using `data.uid` already set at `scheduleAlerts.ts:73`. Wire in `app/_layout.tsx` next to `useEventAlerts` (:15). Currently a tap just opens the app — no listener exists anywhere (verified).
7. Optional: `nextcloud-calendar://day/<yyyy-mm-dd>` → `app/(tabs)/calendar/index.tsx` `?date=` param (verify how the calendar view selects its day before binding).
8. Reuse `goBackOrHome` (`src/utils/navigationGuard.ts`) so cold-start deep links have a sane back path.

## Data model / types
- `IntentExtras` type: `{title?, description?, eventLocation?, beginTime?: number, endTime?: number, allDay?: boolean, rrule?, eventTimezone?}` — epoch millis; map into `InitialValues`.
- `InitialValues` (EventForm) needs no change; `rrule` maps through `parseRrule` (`src/features/calendar/utils/parseRrule.ts`) like the import path does.
- Optional `account` param on event links: `useEventByUid` (`src/database/useEventByUid.ts:11`) queries `account_id + uid`; today `[uid].tsx:56` uses `activeAccountId` only — a link for another account's event shows "event not found" (existing copy `event.eventNotFound`).
- No WatermelonDB schema change.

## Edge cases & error handling
- Unknown/deleted UID → existing not-found screen (`[uid].tsx:190-197`) — fine; optionally add "event may belong to another account" hint.
- UID encoding: `eventDeepLink` already `encodeURIComponent`s; incoming links must `decodeURIComponent` (UIDs contain `@`, `/` is possible) — verify expo-router decodes params before adding manual decode.
- INSERT with missing/invalid extras (e.g. `beginTime=0`, bad `rrule`) → open form with safe defaults (now/+1h), drop unparseable fields silently.
- Recurring UID vs occurrence: a link targets the series; detail screen has no occurrence param — document limitation.
- ACTION_SEND share-sheet of an .ics delivers `EXTRA_STREAM`, not a VIEW intent — **not covered** by #224's filters (verify); options: SEND filter + native stream read (scope creep) or document "open with" only.
- http(s) `.ics` links: `readIcsUri` supports `content://`/`file://` only — browsers usually download first; add http fetch as stretch or document.
- Cold start: `+native-intent` runs before `isAppReady` (`app/_layout.tsx:52-68`) — navigation to `/event/*` while unauthenticated/setup state must queue or redirect; verify expo-router initial-route behavior with `(auth)/setup`.
- iOS `.ics` via Files "Open in" uses the document type (on #224); Mail long-press share may deliver `public.data` — covered by imported UTI.

## Tests (jest / tsc / emulator — intents need device testing)
- jest: extend `__tests__/app/+native-intent.test.ts` (exists on #224): INSERT data URI → `/event/new`, non-.ics file drop, `nextcloud-calendar://event/<uid>` passthrough; extras→`InitialValues` mapping unit test (pure function); `useNotificationResponse` routing with mocked `expo-notifications`.
- `tsc --noEmit`; keep changes additive (no existing-suite edits expected).
- Emulator/device matrix: `adb shell am start -a android.intent.action.INSERT -t vnd.android.cursor.item/event --es title X --el beginTime <ms>`; open .ics from Files/Gmail/Drive; `adb shell am start -a VIEW -d "nextcloud-calendar://event/<uid>"`; notification tap cold + warm; iOS: `xcrun simctl openurl` + share an .ics in Mail/Files.
- Verify both cold start and `onNewIntent` (app already running, singleTask).

## Docs & i18n
- USER_GUIDE.md: "Open .ics files", "Create events from other apps (Android)", "Deep links `nextcloud-calendar://event/<uid>`"; README feature line; screenshots under `docs/` if a docs branch is spun up.
- i18n: minimal new keys (e.g. possible `event.fromOtherAccount` hint) across all `src/locales/*.json` (9 locales on dev; #224 already touched them).
- Document Universal Links limitation (scheme-only) and ACTION_SEND caveat.

## Open questions / arbitration notes
- **[mobile+] superset**: needs Discussion/epic arbitration per proposals file; tracking #383.
- Ordering vs #224: extend `+native-intent`/`intentFilters` on that branch, or land #224 then D3 — pick one to avoid double-merge conflicts on `app.config.ts`.
- Native `intent-extras` module vs unprefilled form for v1 — arbitration point (module is small but adds native surface; repo precedent exists).
- Should INSERT also register on `time` scheme / `vnd.android.cursor.dir/event`? Verify what Google Calendar/Samsung declare and what's actually reachable.
- `?account=<id>` param on event links (switch account then resolve) — v2 candidate.
- EDIT/VIEW calendar intents explicitly excluded (can't resolve foreign provider ids) — confirm issue #374 scope is INSERT only.
