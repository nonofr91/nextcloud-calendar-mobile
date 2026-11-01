# D11 — Spoken notifications (CarPlay / Android Auto)
> Scope tag: [mobile+] | Effort: tier0 S / tier1 S-M / tier2 M | Targets: new epic candidate, PR #230 | Tracking: #383

## Goal & UX
Read reminders and server notifications aloud while driving/headphoned, opt-in only.
- **Tier 0 (copy)**: notification text that OS announcement features read well — e.g. body "In 10 minutes: Team meeting, Paris room" — iOS "Announce Notifications" (CarPlay/AirPods) reads title+body natively. verify: Android Auto announces only `MessagingStyle` notifications (not plain alerts), so tier-0 likely gives iOS full value but Android Auto nothing — confirm on Desktop Head Unit.
- **Tier 1 (in-app TTS)**: `expo-speech` speaks on notification receipt while the app is alive (foreground; briefly background). iOS foreground-only. Killed-app speech impossible with expo-notifications alone — needs the tier-2 native path.
- **Tier 2 (Android Auto conversation)**: `NotificationCompat.MessagingStyle` + `RemoteInput` voice reply → "remind me in 10 min", "mark read"; free-form replies chain to D10 intents.
- Privacy: all TTS on-device, no data leaves the phone. Context rules mandatory (quiet hours, in-meeting, channel-aware).

## Upstream dependencies & capability gating
- Notification paths on `dev` today: **local reminders only** — `scheduleEventAlerts` (src/features/notifications/scheduleAlerts.ts:47) posts DATE-trigger notifications on Android channel `event-alerts` (HIGH), `data:{uid}`, copy via `alertBody` (src/features/notifications/alertContent.ts:53). Rescheduled by `useEventAlerts` (app/_layout.tsx:57) and the headless widget task (src/features/widget/sync/backgroundSync.ts:36).
- Push path lives only on branch `feature/notify-push-poc-228` (PR #230): `PushSyncManager` = notify_push WebSocket, foreground-only (disconnects on background, PushSyncManager ~:60); `pushMessageHandler.ts` republishes OCS notifications locally (`trigger:null`, `data:{nid,link}`); `appBadge.ts` posts silent `_badge` notifications; setting `pushNotifications` in settingsStore. D11 tier-1 must discriminate `uid` / `nid` / `_badge` payloads. No FCM — verify: `registerTaskAsync` headless wake covers remote payloads and Android action-taps only, not locally-scheduled posts.
- SDK 57 reachability (verified in node_modules d.ts): `interruptionLevel` supports `timeSensitive` (Notifications.types.d.ts:407,580); `setNotificationCategoryAsync` + action buttons incl. `textInput` exist; Android builder wires `RemoteInput` (ExpoNotificationBuilder.kt:84-89) so text-reply actions work cross-platform; `BigTextStyle` applied (:109); **no `MessagingStyle`/`CarExtender` anywhere** → Auto announce + Auto voice-reply require a custom Expo native module.
- `expo-speech` absent from package.json — add SDK-57 line; `src/services/voice/tts.ts` shared layer already specced by D10 (step 3) and D9.
- F-Droid: `scripts/fdroid-prepare.sh:10` strips expo-notifications → spoken path must no-op when the module is unavailable.

## Implementation (files to touch/create, ordered steps, tier 0 then 1 then 2)
1. `src/features/notifications/alertContent.ts`: add `announceText(event, at)` — single line `"{lead}: {summary}, {location}"` reusing `leadLabel`, `displayLocation`, `meetingProvider` (src/features/widget/core/liveEvent.ts:12,35); drop description from spoken copy.
2. `src/features/notifications/scheduleAlerts.ts`: schedule with `interruptionLevel:'timeSensitive'` (iOS announce eligibility; verify Focus behavior), keep banner copy as `alertBody`, add `data:{uid, at, tag}` for dedup. Push branch equivalent: `pushMessageHandler.ts` should reuse `announceText`-style copy and prefix relative links (impact A8).
3. Tier 0 settings: no toggle needed (OS-side feature); document iOS "Announce Notifications" opt-in.
4. package.json: `expo-speech` ~SDK57.
5. Create `src/services/voice/tts.ts` (if D10 not yet landed): `speak(text,{locale,rate})`, `stop()`, mockable.
6. Create `src/features/notifications/spokenAlerts.ts`: `Notifications.addNotificationReceivedListener` → gate (`canSpeak(context)`: opt-in flag, quiet-hours window, in-meeting suppression via `selectOngoingEvent` (liveEvent.ts:43), dedup map `${uid|nid}:${at}` TTL ~5min, skip `_badge`) → `Speech.speak(announceText(...))`; for `nid` payloads speak `"{app}: {subject}"`.
7. Create `src/features/notifications/useSpokenAlerts.ts` mounting the listener + resubscribing on settings/account change; mount in `app/_layout.tsx` next to `useEventAlerts`.
8. `src/stores/settingsStore.ts`: `spokenAlerts` fields (persisted, default off) — see types below.
9. `src/features/settings/components/NotificationSettings.tsx`: toggle "Read alerts aloud", mode picker (always / only on Bluetooth — verify feasibility), quiet-hours pickers; permission note.
10. Tier 2a (cheap actions, no Auto announce): register category via `setNotificationCategoryAsync` — buttons "Snooze 10 min" / "Mark read" + textInput reply; handle via `addNotificationResponseReceivedListener`; verify: Android headless action-tap reaches `registerTaskAsync` task for locally-scheduled notifications. Snooze = reschedule via `scheduleNotificationAsync` (+10m, same `data`), mark-read = dismiss/cancel.
11. Tier 2b (Auto announce + voice reply): local Expo module `modules/auto-notifications/` (expo-modules API): Android `NotificationCompat.MessagingStyle` + `RemoteInput` post + `BroadcastReceiver` for reply intents → emit JS event; optional `NotificationListenerService` fallback to speak tray posts when killed. Reply text → canned intents ("snooze", "mark read") else D10 `intents.ts`/`actions.ts`. iOS: `intentIdentifiers` on category options for Siri hinting — verify what CarPlay honors.
12. BT awareness (verify): no Expo API exposes audio routes → tier-1 ships "always" + optional Android `AudioManager` check inside the tier-2 module; document the gap.

## Data model / types
- `settingsStore` += `spokenAlertsEnabled:boolean=false`, `spokenAlertsMode:'always'|'bluetooth'='always'`, `spokenAlertsQuietHours:{start:number;end:number}|null` (minutes-of-day, wrap-midnight), `spokenAlertsInMeeting:boolean=true` (suppress while an event is ongoing).
- `SpokenPayload` = `{kind:'alert',uid,at}|{kind:'ocs',nid,subject,link}` parsed from `content.data`; `_badge` excluded.
- Reuse `AlertEvent`/`leadLabel`/`announceText`; no WatermelonDB schema change; transient `lastSpoken` TTL map in-module (no persistence needed).

## Edge cases & error handling
- Opt-in only, default OFF; permission denied → hide toggle explanation + link to system settings (pattern at NotificationSettings.tsx:63-74).
- Quiet hours wrap-midnight; in-meeting suppression except when the spoken alert IS that event's reminder; dedup prevents double-speak after `scheduleEventAlerts` re-runs (cancelAll + reschedule, scheduleAlerts.ts:51).
- `Speech.speak` failures (engine missing/locale) → swallow + `__DEV__` warn; never block the notification handler. Interrupt only on explicit stop, not on incoming notification (queue ≤1 pending, drop oldest).
- Locale mismatch: TTS language = `settingsStore.language` (headless fix pattern: backgroundSync.ts:25 `i18n.changeLanguage`).
- Push `nid` path: skip when `payload.delete`/`delete-all`; links relative → prefix `baseUrl` before speaking/opening (impact A8); OAEP decryption failure under NC35 (R1) is upstream of D11 — nothing to do here but note gating.
- Don't speak while TTS off / quiet / in meeting / DND — verify DND is NOT queryable from Expo; document that OS announcement features still apply their own rules.
- Multi-account: `uid` alert speaks for whichever account produced it; `nid` resolves active account only (pushMessageHandler `setPushAccount`).

## Tests (jest / tsc / emulator — car scenario note)
- jest: `announceText` phrasing matrix (lead+summary+location, no description, URL-stripped); `canSpeak` reducer — quiet-hours midnight wrap, in-meeting suppression, dedup TTL, `_badge`/`nid`/`uid` discrimination; snooze reschedule math (+10m trigger, tag preserved). Extend `__tests__/features/notifications/alertContent.test.ts`; new `spokenAlerts.test.ts` with mocked `Speech`/`Notifications`.
- `tsc --noEmit` + eslint; additive changes, existing suites untouched.
- Emulator/device — car scenario: Android Auto cannot be fully emulated → Desktop Head Unit (DHU) + `adb` broadcast to validate MessagingStyle announce/reply; iOS Announce needs physical AirPods/CarPlay or per-app OS setting — manual checklist. Simulate car with a BT speaker + Focus/DND profile; verify channel `event-alerts` importance and timeSensitive breakthrough.

## Docs & i18n
- USER_GUIDE.md "Spoken notifications" section: tier table, iOS Announce opt-in steps, Android Auto limits (MessagingStyle native note), privacy note (on-device TTS); README feature line; settings screenshot under `docs/`.
- i18n: `settings.notifications.spoken*` + `notifications.spoken*` keys in all 9 `src/locales/*.json`; spoken templates phrased naturally per locale ("Dans 10 minutes : …"); share voice/locale selection with D9/D10 TTS layer.

## Open questions / arbitration notes
- **[mobile+] superset**: requires explicit Discussion/epic before PR (#382 arbitration; tracking issue #383).
- Biggest unknown: does Android Auto announce non-MessagingStyle notifications? If no (likely per platform docs), tier-0's "Auto reads natively" claim shrinks to iOS and MessagingStyle becomes a tier-1.5 prerequisite — verify on DHU before scoping.
- Tier-1 honesty: `addNotificationReceivedListener` fires only while the app is alive; killed-app speech needs `NotificationListenerService` or alarm-driven native posting — whether to bundle that in tier 1 (M effort) or defer to tier 2.
- Bluetooth-route gating has no pure-Expo solution — ship "always" mode first or pull the AudioManager check into the native module?
- Ordering vs #230: local-reminder path works on `dev` today (MVP without push); `nid` spoken path and copy alignment wait on #230 merge + OAEP fix (R1).
- Reply intents overlap D10 (`intents.ts`/`actions.ts`): canned actions can ship in tier 2a without D10; free-form voice replies should wait for the D10 pipeline rather than duplicating parsing.
