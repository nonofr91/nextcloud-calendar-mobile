# D1 — Geofenced reminders
> Scope tag: [mobile+] | Effort: M | Targets: new epic candidate | Tracking: #383

## Goal & UX
Per-event opt-in "remind me on arrival / on departure" for events with a physical `LOCATION`. In `EventForm`, below the existing `AlertPicker` (src/features/event/components/EventForm.tsx:360), a `GeoAlertPicker` row adds two pills ("On arrival", "On departure") shown only when `location` is non-empty and not virtual (`isVirtualLocation`, src/features/map/utils/isVirtualLocation.ts). On save, the geofence is registered at OS level; when the device crosses the boundary, a local notification fires ("Arriving: <summary>", "Leaving: <summary>") reusing `alertBody` (src/features/notifications/alertContent.ts). Geofence config is **local-only** (per device, never written to ICS).

## Upstream dependencies & capability gating
- **New dependency**: `expo-location` — absent from package.json (verify: SDK 57 line, likely `~19.x`; repo pins `~57.x` for all expo-* packages). `expo-task-manager` already present (:54).
- No server capability — feature is 100% device-side; gating = runtime permissions + presence of a resolvable location, not Nextcloud version.
- `app.config.ts`: add `expo-location` config plugin (plugins array :73) — it injects iOS `NSLocationWhenInUse/AlwaysAndWhenInUseUsageDescription` and Android `ACCESS_FINE/COARSE_LOCATION`; `isAndroidBackgroundLocationEnabled`/`isIosBackgroundLocationEnabled` options for `ACCESS_BACKGROUND_LOCATION` + iOS `location` UIBackgroundMode (verify exact plugin option names for SDK 57).
- Android Play policy: background-location requires an in-app prominent disclosure + Play Console declaration; iOS requires the two-step "While In Use → Always" flow. Both need dedicated UX copy, not just a system prompt.

## Implementation (files to touch/create, ordered steps)
1. `package.json`/`yarn.lock`: add `expo-location`; `app.config.ts` plugin + permission strings.
2. Create `src/features/geofence/store.ts` — MMKV map (`storage`, src/storage/index.ts) keyed `${accountId}:${uid}` → `GeoAlertPref`. No WatermelonDB schema change.
3. Create `src/features/geofence/target.ts` — resolve `LOCATION` text → `MapCoordinates`: reuse `parseLocation` (geo:/coords/map-URL, src/features/map/utils/parseLocation.ts:17) then `geocodeLocation` (Nominatim + 30d MMKV cache, src/features/map/utils/geocode.ts:158).
4. Create `src/features/geofence/service.ts` — `refreshGeofences()`: read prefs × upcoming events (`readUpcomingEvents`, src/features/widget/core/readEvents.ts:29), drop past/deleted/virtual, sort by `dtstart`, cap at `MAX_GEOFENCES` (iOS ~20 / Android ~100 → per-platform constants, verify current OS limits), `Location.startGeofencingAsync(GEOFENCE_TASK, regions)`; region `identifier` = pref key, `notifyOnEnter`/`notifyOnExit` per mode (verify both flags exist on `LocationRegion`).
5. Create `src/features/geofence/task.ts` — module-level `TaskManager.defineTask(GEOFENCE_TASK, …)` mirroring src/features/widget/sync/backgroundSync.ts:40; on Enter/Exit → look up pref → `i18n.changeLanguage(settingsStore.language)` (headless, cf. :27) → `Notifications.scheduleNotificationAsync` with `trigger: null` (immediate, verify expo-notifications supports null trigger) on the existing `event-alerts` channel.
6. `index.ts` or `app/_layout.tsx`: import `task.ts` early so the task is defined before events arrive (same constraint as backgroundSync.ts, imported via `useWidgetSync`).
7. Create `src/features/event/components/GeoAlertPicker.tsx`; wire into `EventForm` (new `geofence` state + submit), extend `CreateEventInput` with `geofence?: 'arrive' | 'leave' | 'both'` — never serialized: `buildIcs*` take explicit params (src/utils/ics.ts:134), so the field is inert in ICS.
8. `src/features/event/hooks/useMutateEvent.ts`: after successful create/update (verify hook return paths :197/:227), `saveGeoAlertPref(accountId, uid, mode)` + `refreshGeofences()`; on delete, remove pref.
9. Create `src/features/geofence/useGeofenceSync.ts` — mount beside `useEventAlerts` in `app/_layout.tsx` (:57): rerun `refreshGeofences()` on account change, observed event changes, AppState→active, and after sync (same triggers as `scheduleEventAlerts`).
10. `src/features/settings/components/NotificationSettings.tsx` (or new section): master toggle + radius + permission-status row with `Linking.openSettings()` CTA (pattern :68-73).
11. `eventToInput.ts` (:20): pass stored pref into the form on edit.

## Data model / types
- `GeoAlertPref = { mode: 'arrive'|'leave'|'both'; lat: number; lon: number; resolvedFrom: string; radius?: number; updatedAt: number }` — MMKV JSON map `geofence_prefs`.
- `CreateEventInput.geofence?: 'arrive'|'leave'|'both'` (src/types/index.ts:88); `CalendarEvent` unchanged — pref lives outside the event row.
- `settingsStore` += `geofenceEnabled: boolean` (default false), `geofenceRadius: number` (default ~150 m; verify iOS effective minimum ~100-200 m); persist version bump.
- No ICS round-trip: an `X-NCM-GEOFENCE` prop would survive edits via `extractExtraVeventLines` (src/utils/caldav-parse.ts:415, not in `WRITER_MANAGED_PROPS` :409) but is rejected — a geofence is per-device state and would confuse other clients.

## Edge cases & error handling
- Geocode fails / offline at save → keep pref pending with `resolvedFrom` text, retry on next `refreshGeofences` when online; show "location not found" state in the picker.
- `LOCATION` edited → re-resolve on save; event deleted/series ended → prune in `refreshGeofences`; past events pruned like `scheduleEventAlerts` (`MAX_SCHEDULED=60`, scheduleAlerts.ts:16).
- Cap exceeded → nearest `dtstart` wins, rest stay queued; re-evaluated every refresh (LRU-by-upcoming, not true LRU — simpler and fairer).
- Recurring events: region keyed by `uid` fires every occurrence — acceptable v1; note re-arm semantics.
- Permission denied (foreground or Always) → pills disabled + hint text; `hasStartedGeofencingAsync` on launch to detect OS-level loss; re-register on reboot (verify iOS re-registers regions automatically; Android geofences persist but re-register anyway for consistency).
- Battery/Doze: geofencing is OS-fused low-power; no exact-alarm interplay since the notification fires immediately on trigger (no future scheduling → `cancelAllScheduledNotificationsAsync` in scheduleAlerts.ts:51 does not touch it).
- No dwell support in expo-location → ENTER fires on first crossing; mitigate with default radius ≥150 m; optional deferred re-check via `getCurrentPositionAsync` in task (battery cost — v2).

## Tests (jest / tsc / emulator — note: geofencing needs device testing)
- jest: `target.ts` (geo:/text/unresolvable/online-offline), `store.ts` CRUD + prune, `service.ts` region selection/cap ordering with mocked `expo-location` (mock pattern exists in `__mocks__/`; suites live in `__tests__/features/…`, e.g. `__tests__/features/map/geocode.test.ts`).
- `tsc --noEmit` + existing jest suite untouched.
- **Device-only verification**: real-device field testing (simulators can't drive geofences realistically; Android emulator allows GPS mock routes — limited value). Test matrix: app foreground/background/killed, reboot, permission upgrade flow, cap eviction.

## Docs & i18n
- USER_GUIDE section: per-event pills, permission walkthrough (Android disclosure, iOS Always), radius default, "not synced / this device only" note; Play Console data-safety + background-location declaration update.
- i18n: `settings.alerts.onArrival`/`onDeparture`, `settings.geofence.*` (toggle, radius, permission hints, "location not found") across all 9 `src/locales/*.json`.

## Open questions / arbitration notes
- **[mobile+] superset**: zero web counterpart — needs an explicit Discussion/epic before any PR (#382 arbitration; tracking pointed at #383 in proposals — verify issue vs Discussion id).
- Config storage: **local-only recommended** (geofence = this-device state; ICS X-prop technically preserved but semantically wrong for roaming).
- Geocoding: reuse Nominatim path (`geocodeLocation`) vs on-device `Location.geocodeAsync` — Nominatim has the cache + match heuristics already, but background geocoding under Nominatim ToS for many events needs throttling (verify rate limits / cache-first is enough).
- Dwell: expo-location exposes no dwell flag (verify) — accept enter-on-cross for v1 or implement delayed re-check in task.
- iOS "Always" consent UX is heavy; consider shipping Android-quality flow first behind the same toggle.
