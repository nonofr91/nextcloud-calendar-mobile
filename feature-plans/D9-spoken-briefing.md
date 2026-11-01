# D9 — Spoken day briefing (TTS)
> Scope tag: [mobile+] | Effort: tier1 S-M / tier2 M | Targets: new epic candidate | Tracking: #383

## Goal & UX
"Listen to my day": one tap reads today's agenda aloud. Tier 1 builds the script locally from WatermelonDB events ("You have 4 events today: Team meeting at 9 AM in the Paris room…") and speaks it via `expo-speech` — fully on-device, offline, works in every app language the OS has a voice for. Tier 2 optionally asks TaskProcessing `core:text2text` for a nicer text, spoken by the same layer. Triggers: a listen button in the calendar top bar (primary), an opt-in morning notification with a "Listen" action, and later a headset/car-BT-connect trigger (verify: Expo exposes no BT-connect event API → custom native module, out of tier-1 scope). Controls: while speaking, a compact bar offers pause/resume, skip-to-next-event, stop — implemented by speaking one utterance per event so boundaries are natural.

## Upstream dependencies & capability gating
- `expo-speech` is NOT in package.json (verified — expo-notifications ~57.0.7, expo-localization ~57.0.1 present). Add the SDK-57-line version (verify exact tag, likely `~15.x`). Pure native module, no config plugin, no runtime permissions; needs a jest mock.
- Tier 2 = B6 dependency: `core:text2text` requires the server Assistant app + a text2text provider. Capability detection via `GET /ocs/v2.php/taskprocessing/tasktypes` → `taskTypes` in `ServerCapabilities` (src/types/index.ts:93) filled by `fetchCapabilities` (src/services/nextcloud/nextcloud.ts:101) → `useCapabilitiesSync` → `accountStore.capabilities`. D10's plan (features/D10-voice-assistant.md §8-9) already creates `src/services/nextcloud/taskprocessing.ts` + the capability wiring — do NOT duplicate; D9 reuses it (if D10 is not merged, add the same minimal client here and let D10 rebase).
- Tier 1 works with zero capability — it is the unconditional fallback.
- Locale: `Speech.speak(text, { language })` wants a BCP-47 tag — reuse `getNativePickerLocale` (src/utils/i18n.ts:47) built from `settingsStore.language`; fall back to `getLocales()[0].languageTag` when language is 'auto'-ish/system.

## Implementation (files to touch/create, ordered steps, tier 1 then tier 2)
1. package.json: add `expo-speech` (verify SDK 57 version); jest.setup.js: add a `jest.mock('expo-speech')` stub (speak/stop/pause/resume/isSpeakingAsync).
2. Create `src/services/voice/tts.ts` — thin shared wrapper (speak queue, stop, pause/resume, rate, language). This is the SAME module D10's plan already earmarks (its step 3) and D11 will use — create it once, here or there, whichever lands first.
3. Create `src/features/briefing/speechText.ts` — pure-TS script builder: `buildBriefing(events, t, locale)` → `BriefingSegment[]` (one per event + intro/outro). Speech-friendly rules: times via `formatHour`-style "9 AM"/"9 h 30" not "09:00" (src/utils/timeFormat.ts:37-43 is the seed but display-format ≠ speech — new per-locale templates), durations ("for one hour"), all-day events grouped after timed ones, location via `displayLocation` + `meetingProvider` ("call on Talk", src/features/widget/core/liveEvent.ts:12,35) so URLs are never read, attendee first names from `attendees[].displayName` (src/types/index.ts) capped at ~3, tasks (`isTask`) phrased as deadlines. Reuse `stripUrls`/`cleanDescription` patterns from alertContent.ts — never read raw descriptions.
4. Create `src/features/briefing/useBriefing.ts` — state machine `idle → speaking{segmentIndex} → paused → done|stopped`; on start: `readUpcomingEvents(0)` (src/features/widget/core/readEvents.ts:29 — already filters `hiddenCalendarIds`, startOfDay→endOfDay) then drop past events except the in-progress one (see `selectOngoingEvent`, liveEvent.ts:43) → `buildBriefing` → enqueue one `Speech.speak` per segment with `onDone` advancing the index; `Speech.stop()` on unmount/new trigger.
5. Create `src/features/briefing/BriefingBar.tsx` — floating mini-player (play/pause, next, close) rendered above `CalendarFab` in `app/(tabs)/calendar/index.tsx`.
6. Entry point: headphones/speaker `IconButton` in `CalendarTopBar` header row (src/features/calendar/components/CalendarTopBar.tsx:38-69, before the Today button), wired through `app/(tabs)/calendar/index.tsx:148-155`; visible in all view modes but reads the briefing for the *displayed* day (schedule mode = `agendaVisibleDate`, else `date`) — verify whether spec wants today-only; today-only is simpler and matches "my day".
7. Settings: opt-in "Morning briefing" toggle + time picker in `src/features/settings/components/NotificationSettings.tsx` (settingsStore persist, src/stores/settingsStore.ts:11); scheduling reuses `scheduleEventAlerts` pattern (src/features/notifications/scheduleAlerts.ts:47) — a daily calendar-trigger notification on channel `event-alerts` with `data: { action: 'briefing' }`.
8. "Listen" action: requires `Notifications.setNotificationCategoryAsync` + `addNotificationResponseReceivedListener` — NEITHER exists today (verified: only `data:{uid}` is set, no response listener anywhere) → add a small `useNotificationActions` hook in `src/features/notifications/` mounted in `app/_layout.tsx` (next to `useEventAlerts`, line 57): on the briefing action, route to `/(tabs)/calendar` and auto-start the briefing. Honest limit: the action opens the app first — expo-speech cannot speak from a killed/backgrounded JS runtime.
9. Tier 2: `src/features/briefing/aiBriefing.ts` — prompt builder (compact JSON of today's events + style rules: short, spoken register, user's language) → `scheduleTask`/`pollTask` from D10's `taskprocessing.ts` (`type:'core:text2text'`) → plain-text answer segmented per event (ask the model for one line per event, split on newlines; keep tier-1 builder as fallback if output is unusable). Behind a settings toggle shown only when `taskTypes` includes `core:text2text`; silent tier-1 fallback on 412/429/timeout/offline.
10. Later (verify): BT/car-connect trigger — no Expo API; needs a native module or `react-native-ble`/headset-event package; evaluate with D11 which wants the same trigger.

## Data model / types
- `BriefingSegment = { key: string; text: string; eventUid?: string }` — per-segment keys let "skip" jump by event.
- `BriefingState = { status: 'idle'|'speaking'|'paused'|'error'; index: number; segments: BriefingSegment[] }` in a zustand store (`src/stores/`) or local state in `useBriefing` — verify D10/D11 need cross-screen access before promoting to a store.
- `settingsStore` += `briefingEnabled: boolean`, `briefingTime: string` ('08:00'), `briefingUseAI: boolean` (default false — opt-in, privacy).
- `ServerCapabilities` += `taskTypes?: string[]` — planned in D10; shared, not duplicated.
- No WatermelonDB schema change.

## Edge cases & error handling
- Empty day → spoken "No events today" + close; all-day-only day → all-day phrasing ("all day:" prefix).
- Hidden calendars already excluded by `readUpcomingEvents`; also exclude events on `notifDisabledCalendarIds`? — verify: spec doesn't say; briefing is user-initiated so hidden-only filtering is defensible.
- Speaking while another TTS runs (D10 reply, D11 announcement) → single shared `tts.ts` queue serializes; define who wins (briefing yields to user-initiated voice reply).
- App backgrounded mid-briefing: expo-speech is in-app JS — iOS suspends utterances when backgrounded unless the audio session is `playback` + background-audio entitlement; expo-speech does not configure AVAudioSession itself (verify: `expo-audio` `setAudioModeAsync({ playsInSilentMode })` may fix mute-switch + bg) — be explicit in docs: briefing is a foreground feature; stop() on AppState 'background'.
- Silent switch / audio focus: iOS default session may mute speech when the ringer is off; Android uses STREAM_MUSIC + transient focus — verify both on device.
- Very long days → cap at ~20 segments; overdue events phrased "earlier today".
- Tier 2: offline → tier 1 silently; 429 → cooldown + tier 1; poll timeout (~45 s) → tier 1; never block the button on the AI path (run tier-1 text immediately if AI toggle is on? — arbitration: instant local vs better-but-slow AI; recommend local-first, AI only when opted-in, with a generating spinner on the bar).
- Multi-account: reads the ACTIVE account only (readUpcomingEvents uses `activeAccountId`) — matches widget behavior.

## Tests (jest / tsc / emulator)
- jest: `speechText.ts` matrix — counts/plurals EN+FR, 12h/24h locales, all-day vs timed, duration phrasing, location→provider ("call on Talk"), URL stripping, attendee cap, empty day. Pattern after `__tests__/features/notifications/alertContent.test.ts`.
- `useBriefing` reducer tests with mocked `expo-speech` (segment advance on onDone, stop on unmount); `aiBriefing.ts` with mocked taskprocessing (ok/412/429/timeout→fallback).
- `tsc --noEmit` + eslint; additive change → existing suites untouched (add `expo-speech` mock to jest.setup.js).
- Emulator/device: voices installed for fr/en (Android TTS engine presence — speak error path), pause/skip UX, iOS silent-switch behavior, action notification → app open → autoplay, tier 2 against a server with Assistant+text2text and one without.

## Docs & i18n
- README feature line; docs section (privacy: tier 1 = nothing leaves the device; tier 2 sends event titles/times/attendee names to the server AI — requires explicit opt-in).
- i18n: `briefing.*` keys (button a11y label, player controls, empty-day line, settings) + per-locale spoken templates in all 9 `src/locales/*.json`; spoken templates are text-generation, not `t()` interpolation alone — keep the grammar helpers in `speechText.ts` with locale-switched templates (EN/FR first-class like alertContent).
- a11y: button needs `accessibilityLabel`; announce segments to screen readers? — verify TalkBack/VoiceOver double-reading.

## Open questions / arbitration notes
- **[mobile+] superset**: needs the Discussion/epic arbitration (#382 → #383) before any PR; D9/D10/D11 share `tts.ts` + `speechText.ts` — one epic or three? Recommendation: ship the shared voice layer inside whichever lands first (likely D9, simplest).
- Button placement: top-bar icon (all modes) vs agenda-only header vs FAB long-press — needs UX mockup; top bar is cheapest.
- "Displayed day" vs "today only" — spec says "my day"; today-only is unambiguous, displayed-day is more useful in schedule mode. Arbitration.
- Morning-notification "Listen" requires notification-action plumbing that doesn't exist (no response listener) — worth it alone? Or fold into D11's notification work to avoid two competing listeners.
- iOS silent-switch & background playback limits may make the feature feel broken — verify early on device; if expo-speech can't satisfy, evaluate `expo-audio`+pre-rendered speech (heavy) or accept foreground-only.
- Effort: tier 1 S-M (builder+player+button ≈ M once notification action is included; S without), tier 2 M assuming D10's taskprocessing client exists — else M-L.
