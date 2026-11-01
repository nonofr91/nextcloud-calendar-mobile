# D6 — Wearables (Wear OS / watchOS)
> Scope tag: [mobile+ strict] | Effort: L | Targets: new epic candidate | Tracking: #383

## Goal & UX
Read-only agenda glanceables on the wrist: next event + today's list, fed by the phone's
existing widget snapshot pipeline. MVP = Wear OS Tile + one complication; watchOS =
complications shipped inside a minimal WatchKit app shell (no full watch UI). Taps
deep-link into the phone app (`eventDeepLink`, src/features/widget/core/types.ts:62).
Non-goals v1: creating/editing from the wrist, free-busy, voice reply — "reply/snooze"
exists only as notification actions mirrored from the phone (chains to D10/D11).
Honest scope note: furthest from web parity in the catalog → strict arbitration, new epic.

## Upstream dependencies & capability gating
- Zero server dependency: the feed is the WatermelonDB-derived `AgendaSnapshot` already
  built for widgets — no CalDAV, no `ServerCapabilities`. Gating = pairing detection only
  (`CapabilityClient` / `WCSession.isWatchAppInstalled`); feature silently absent otherwise.
- Internal prerequisite: actionable notifications do NOT exist today —
  `src/features/notifications/scheduleAlerts.ts` schedules plain DATE triggers; no
  `setNotificationCategoryAsync`, no `addNotificationResponseReceivedListener` anywhere
  (verified: zero matches). Snooze/open must be added before wrist actions work.
- verify: expo-notifications category/action parity iOS vs Android; whether push (#230)
  notifications can also carry categories.

## Implementation (files to touch/create, ordered steps, minimal-viable-first)
Phase 0 — shared feed (phone side):
1. Create `src/features/wear/wearSnapshot.ts` — derive compact `WearAgendaSnapshot` from
   `buildAgendaTimeline` output (src/features/widget/core/agendaSnapshot.ts:159); cap ≤8
   items, today+tomorrow, labels pre-localized by the phone.
2. Create `modules/wear-bridge/` — local Expo module after the `modules/live-updates`
   pattern (`expo-module.config.json`, `android/.../WearBridgeModule.kt` wrapping
   `Wearable.getDataClient().putDataItem(PutDataMapRequest "/agenda")` +
   `CapabilityClient`; `ios/WatchBridgeModule.swift` wrapping
   `WCSession.updateApplicationContext` + `reachable` state). Autolinks like siblings.
3. Create `src/features/wear/pushWearSnapshot.ts`; call it from `runSync`
   (src/features/widget/sync/syncWidget.ts:40-49, after `homeWidget.update`) and from
   `runBackgroundWidgetSync` (src/features/widget/sync/backgroundSync.ts:31-33) so the
   watch rides the same refresh triggers (DB observe + 60 s tick + 15-min bg task).
   Push only when payload hash changed.
Phase 1 — Wear OS:
4. `android/wear/` Gradle module; `include ':wear'` in `android/settings.gradle` (beside
   `include ':app'`). Minimal Wear app: `AgendaTileService` (TileService, reads the
   `/agenda` DataItem), one `ComplicationDataSourceService` (SHORT_TEXT next event),
   stub Activity for "open on phone". Package `com.soluce.nextcloudcalendar.wear`.
   verify: embed via `wearApp project(':wear')` in `android/app/build.gradle` vs
   standalone Wear listing; Gradle/version-catalog interplay with `expoAutolinking`.
Phase 2 — watchOS:
5. Add a Watch App target to `ios/NextcloudCalendar.xcodeproj` — the pbxproj is committed
   and already carries a hand-integrated `ExpoWidgetsTarget` (Podfile:79); a
   `plugins/withWatchApp.js` config plugin would fight prebuild — verify: edit Xcode
   manually and document, do not automate.
6. Watch target: `ComplicationController` (WidgetKit for watchOS; CLKComplication only if
   deployment target demands — verify) reading the `WCSession` context persisted to the
   shared App Group `group.com.soluce.nextcloud-calendar` (already declared,
   app.config.ts:47, used by widget MMKV id at src/features/widget/storage/widgetStore.ts:5).
Phase 3 — actionable notifications (chains D11):
7. `scheduleAlerts.ts`: add `categoryIdentifier: 'event-alert'` on each scheduled item +
   `Notifications.setNotificationCategoryAsync` with `snooze`/`open` actions; a response
   listener reschedules a one-shot DATE trigger. Wear OS mirrors phone actions for free;
   watchOS actionability limited to notifications actually delivered to the watch — verify.

## Data model / types
- `WearAgendaSnapshot` = subset of `AgendaSnapshot` (types.ts:23-34):
  `{generatedAtIso, timeZone, locale?, scheme, dayLabel, dayNumber, nextEvent?, items:
  AgendaEventItem[] (≤8)}`; serialize as JSON string in DataMap key `agendaJson`
  (Android) / `[String:Any]` application context (iOS). Reuse `AgendaEventItem`
  (types.ts:3-12) incl. `deepLink`.
- No WatermelonDB schema change; no new store — push is fire-and-forget. Optional
  `settingsStore.wearEnabled` opt-out flag.
- Payload budget ≤ ~10 KB JSON (DataClient item cap ~100 KB — verify current limit);
  complication reads `nextEvent` only.

## Edge cases & error handling
- No watch paired / app not installed → bridge reports unreachable, push no-ops; no UI
  surface appears on the phone.
- Staleness: watch renders `generatedAtIso` age ("updated 2 h ago" beyond ~30 min),
  empty state beyond 24 h; Wear tile refresh quotas are small → sparse timeline only.
- Battery: push on hash-change only (never on the 60 s widget tick); watch side must
  answer complications from the cached DataItem synchronously — no listeners that poll.
- Timezone/travel: snapshot carries `timeZone`; regenerate on TZ/locale change (widget
  sync already does via `useWidgetSync` deps, hooks/useWidgetSync.ts).
- Snapshot covers the active account only (`readUpcomingEvents` uses `activeAccountId`,
  core/readEvents.ts:30) — multi-account (D5) revisits this later.
- All bridge failures swallowed + `__DEV__`/`console.warn('[wear] …')`, matching the
  `[widget] sync failed` pattern (syncWidget.ts:60); a failed push must not break
  `syncWidget`.

## Tests (jest / tsc / device — emulators + physical watch)
- jest: `wearSnapshot` transform (caps, ordering, all-day flags, empty input);
  `pushWearSnapshot` hash-throttle; notification action handler (snooze →
  `scheduleNotificationAsync` mock re-arm). Reuse `__tests__/features/widget/` patterns.
- `tsc --noEmit`; existing suites untouched (all changes additive).
- Device matrix: Wear OS emulator via adb pairing + one physical watch (tile quota and
  complication refresh are not faithful in emulation); watchOS simulator pairing is
  flaky → physical Watch required; verify Data Layer/`updateApplicationContext` delivery
  while the phone app is backgrounded and killed.
- e2e (e2e/, Maestro) cannot drive a watch → manual checklist documented instead.

## Docs & i18n
- README.md feature line; this plan under `.devin/plans/features/`. No USER_GUIDE.md
  exists in repo (D10 referenced one speculatively — verify whether it lands first).
- i18n: watch-side strings minimized — `timeLabel`/labels are pre-rendered into the
  snapshot by the phone (agendaSnapshot.ts:52/89); add `wear.*` keys only for a
  watch-rendered empty/stale state → all 9 `src/locales/*.json`.
- Document pairing prerequisites, and that account data never leaves the paired
  Google/Apple relay (no third-party server); battery expectations.

## Open questions / arbitration notes
- [mobile+ strict]: needs its own Discussion/epic before any PR (#382 arbitration);
  tracking pointed at #383 — verify issue vs Discussion (same caveat as D10).
- Packaging: embedded `wearApp` auto-installs to paired watches but inflates the AAB and
  review surface; F-Droid build must exclude the wear module — verify how
  `scripts/fdroid-prepare.sh` treats `modules/` and a `:wear` subproject.
- watchOS ordering: iOS already ships accessory complications on the lock screen; a real
  watch target adds App Store review surface + assets — recommend Wear OS tile first,
  watchOS as a follow-up inside the same epic.
- The genuinely "actionable" part is notification actions, which belong to epic #255
  scope — recommend landing categories/actions there first; D6 then only consumes them.
- Snooze semantics: v1 = local re-trigger only; never writes CalDAV from the wrist
  (offline mutation queue = D4, out of scope).
- verify: react-native-mmkv App-Group behavior — irrelevant to wearables anyway (the
  watch cannot read phone storage); the bridge is the only feed path.
