# D10 — Conversational voice assistant
> Scope tag: [mobile+] | Effort: tier1 M-L / tier2 L | Targets: new epic candidate | Tracking: #383

## Goal & UX
Tap-to-talk mic button (calendar screen header or FAB) → bottom sheet with live transcript, parsed-intent confirmation card, spoken + textual reply. Voice → action → voice loop; wake-word / always-listening explicitly out of scope.
- **Tier 1 (local, no AI)**: on-device STT → local intent matching → direct CalDAV/local DB → `expo-speech` reply. Intents: create event ("Lunch with Marc tomorrow 12:30"), move/delete ("move my 3pm call to 4pm"), next event / day agenda (reads WatermelonDB, works offline), free-busy check ("is Marc free Tuesday 3pm?").
- **Tier 2 (server agent)**: free-form question → `core:contextagent:interaction` TaskProcessing task → Nextcloud Context Agent runs its own tools (`find_free_time_slot_in_calendar`, `schedule_event`, contacts/tasks tools) → text output → TTS. Audio-native `ContextAgentAudioInteraction` only if advertised in tasktypes (verify: which context_agent version exposes it and its audio input shape).
- Hard confirmation gate before any mutation; read-only intents answer directly.

## Upstream dependencies & capability gating
- TaskProcessing OCS exists since NC 30; `core:contextagent:interaction` only when the admin installed `assistant` + `context_agent` + an AI provider + enabled the tool groups.
- Detect via `GET /ocs/v2.php/taskprocessing/tasktypes` (→ `types` map keyed by task type id, each with `inputShape`/`outputShape`). Cache result in `ServerCapabilities` (src/types/index.ts:93) populated by `fetchCapabilities` (src/services/nextcloud/nextcloud.ts:101) → `useCapabilitiesSync` (src/hooks/useCapabilitiesSync.ts) → `accountStore.capabilities`.
- Degrade to tier 1 when the task type is absent, on 412 (provider unavailable). Keep tier 1 for availability questions regardless: the pure CalDAV free-busy POST (`src/services/nextcloud/freeBusy.ts`, on branch `feature/find-time-229` — not yet on dev) already answers "is X free at Y" with zero AI.
- Rate limit: 20 tasks / 2 min / user → client-side throttle + cooldown on 429 (`trustedFetch` already honors `Retry-After`, src/services/shared/trustedFetch.ts:156-164).
- Tasks are ASYNC: `POST /ocs/v2.php/taskprocessing/schedule` returns a `task` object → poll `GET /ocs/v2.php/taskprocessing/task/{id}` (~1.5–2 s interval, ~45 s budget). Latency is seconds and depends on server background-job workers (docs recommend ≥4); UI needs a "thinking…" state (spinner + optional interim TTS).

## Implementation (files to touch/create, ordered steps, tier 1 then tier 2)
0. Dependencies (package.json — currently absent): `expo-speech` (SDK 57 line); `expo-speech-recognition` (third-party config plugin — verify SDK 57 compat; fallback = tiny custom native module, project already builds via `expo-dev-client`/`expo run:*`).
1. `app.config.ts`: iOS `NSSpeechRecognitionUsageDescription` + `NSMicrophoneUsageDescription`; Android `RECORD_AUDIO` (permissions array at :54) + plugin entry (:73).
2. Create `src/services/voice/stt.ts` — thin mockable wrapper (start/stop, locale, partial results).
3. Create `src/services/voice/tts.ts` — `expo-speech` wrapper (locale, rate, `Speech.stop()` interrupt). Shared layer with D9 (spoken briefing) and D11 (spoken notifications).
4. Create `src/services/voice/intents.ts` — pure-TS parser → `VoiceIntent` (regex + relative-date parser built on `dayjs`, already a dep; verify: no chrono-node in package.json → hand-rolled EN/FR patterns first).
5. Create `src/services/voice/actions.ts` — map intents onto existing APIs: `useCreateEvent`/`useUpdateEvent`/`useDeleteEvent` (src/features/event/hooks/useMutateEvent.ts:197/227/342), `useEventsForRange` (src/database/useEvents.ts:46) for next/agenda, `fetchSharees` (src/services/nextcloud/sharees.ts:163) to resolve spoken names → attendee emails, `fetchFreeBusy` + `useFreeBusy` (feature/find-time-229) for availability.
6. Create `src/features/voice/` — `VoiceAssistantSheet.tsx` + `useVoiceAssistant.ts` state machine: `idle → listening → parsed → confirming → executing → replying → idle|error`.
7. Entry points: mic button in `app/(tabs)/calendar/index.tsx`; opt-in toggle + tier status in a new `app/(tabs)/settings/voice.tsx` linked from `settings/index.tsx`.
8. Tier 2 — create `src/services/nextcloud/taskprocessing.ts`: `fetchTaskTypes`, `scheduleTask` (`input` keyed by `inputShape`, `type`, `appId:'calendar-mobile'`, optional `customId`), `pollTask`. Reuse the `basicAuth` + `trustedFetch` + `OCS-APIRequest` pattern from src/services/nextcloud/nextcloud.ts:5-21.
9. Capability wiring: extend `ServerCapabilities` with `taskTypes?: string[]` (or `contextAgentEnabled: boolean`); fetch tasktypes inside `fetchCapabilities`.
10. Tier-2 path in the state machine: STT → text prompt → schedule → poll → TTS; prefer the audio-native task only when advertised.

## Data model / types
- `VoiceIntent` discriminated union: `create | move | delete | next | agenda | freebusy | chat`, slots `{summary?, when?, target?, names?: string[], window?: {start,end}}`.
- `TaskProcessingTask` `{id, type, status:'scheduled'|'running'|'successful'|'failed'|'cancelled', output?}` (verify exact field names against `jsonSerialize()` of the OCS task).
- `ServerCapabilities` += `taskTypes?: string[]`.
- No WatermelonDB schema change; transient transcript/reply in a zustand store (`src/stores/`); persist opt-in flag + preferred tier in `settingsStore`.

## Edge cases & error handling
- Mic/STT permission denied or unsupported locale → hide the mic entry point or speak a localized error; feature is OFF by default (opt-in).
- Ambiguous person ("Marc" → several sharees) → spoken disambiguation list; never guess an attendee.
- No mutation without explicit user confirmation (voice "yes" or tap); cancelling the sheet aborts.
- Poll timeout (~45 s) → spoken "server is still thinking, try later"; keep `customId`/task id for a manual retry.
- 429 → cooldown + spoken notice; 412/absent task type → silent tier-1 fallback; offline → tier-1 reads still work off WatermelonDB, mutations fail cleanly (offline mutation queue = D4, out of scope).
- Interrupt TTS on new input; replies must be interruptible.
- Platform limits: iOS speech-recognition on-device availability per locale, Android background STT restrictions — verify per platform.
- Free-busy always via direct CalDAV (not via the agent) → reliable, cheap, no rate-limit burn.

## Tests (jest / tsc / emulator)
- jest: `intents.ts` phrase matrix (EN/FR, relative dates, ambiguous names); `actions.ts` with mocked hooks/services; `taskprocessing.ts` with mocked `trustedFetch` (tasktypes/schedule/poll/412/429); capability-gating + disambiguation reducer cases.
- `tsc --noEmit` + eslint; existing suites untouched (changes are additive).
- Emulator/device: permission flows, STT accuracy EN/FR, end-to-end against NC ≥30 with Assistant + context_agent + provider configured; regression on a server with no AI apps (tier-1 only).

## Docs & i18n
- USER_GUIDE.md "Voice assistant" section (tier table, admin prerequisites for tier 2, privacy note: tier 1 never leaves the device); README feature line; settings screenshot under `docs/`.
- i18n: add `voice.*` keys to all 9 `src/locales/*.json`; spoken templates must phrase dates/times naturally per locale; TTS voice/locale selection shared with D9/D11.

## Open questions / arbitration notes
- **[mobile+] superset**: needs an explicit Discussion/epic before any PR (#382 arbitration); proposals file points tracking at #383 — verify which is the issue vs the Discussion.
- STT dependency: `expo-speech-recognition` vs custom native module — verify maintenance status and SDK 57 compatibility.
- Date parsing: chrono-node (extra dep, richer) vs hand-rolled `dayjs` patterns (EN/FR only at first).
- MCP-client alternative (SSE/HTTP to the context_agent MCP server): more moving parts inside RN — not recommended for v1.
- Tier-2 latency (async task + worker count) may make voice feel sluggish — arbitration: is tier 2 justified when tier 1 + free-busy covers the core intents? Consider shipping tier 1 first.
- Entry-point placement (header vs FAB vs long-press on the calendar tab) needs a UX mockup; D9/D11 triggers should not fight over the TTS layer.
