# D7 — OCR poster/flyer → prefilled event
> Scope tag: [mobile+] | Effort: M | Targets: new epic candidate | Tracking: #383

## Goal & UX
Photograph a poster/flyer/business card → on-device text recognition → heuristics extract title/date/time/location → open the existing create-event form prefilled for user review. Nothing is saved without the user pressing save in `EventForm` — the OCR only produces a draft.
- Entry point: FAB "+" (`app/(tabs)/calendar/index.tsx:213-222`, `CalendarFab`) opens a small choice sheet (`src/ui/components/Sheet.tsx` exists): "New event" / "Scan a poster". Long-press on FAB = alternative to arbitrate.
- Flow: `app/event/scan.tsx` (new route) — camera preview (already-dep `expo-camera`, `CameraView` + `takePictureAsync`) or gallery pick → spinner "Reading text…" → extraction preview (editable mini-summary + "looks wrong? continue anyway") → push `/event/new` prefilled.
- Graceful fallback: if OCR finds no date/title, prefill what we have (or nothing) and land on the normal empty form — never block.
- Privacy: 100 % on-device (Google ML Kit); captured image kept in cache dir only, deleted after recognition; explicit "no image leaves the device" line in the preview sheet.

## Upstream dependencies & capability gating
- **No server dependency** — pure client feature; no `ServerCapabilities`/`fetchCapabilities` change (unlike D10). Works on any NC version, offline included.
- Camera permission: `expo-camera` plugin already declared in `app.config.ts:92-97` — its usage string is QR-login-specific, needs rewording or a second purpose string (iOS `NSCameraUsageDescription`).
- **OCR library — verify:** `@react-native-ml-kit/text-recognition` or the `@infinitered/react-native-mlkit-*` suite (Nitro-based; `react-native-nitro-modules` already in package.json:69). ML Kit = free, on-device, Latin script covers FR+EN (+DE/ES/IT/PT/NL/OC). Not Expo-Go compatible → dev-client/EAS only (project already uses `expo-dev-client` + `expo run:*` + local `modules/*` — precedent: `modules/zxing-scanner` is Android-native with an `expo-camera` JS fallback, `QrScannerView.tsx` vs `.android.tsx`, `hasExpoCamera` via `requireOptionalNativeModule`). Verify: SDK 57/RN 0.86 compat, iOS+Android coverage, maintenance status; fallback = custom `modules/text-recognition` wrapping ML Kit directly.
- **Gallery pick — verify:** no `expo-image-picker` in package.json; v1 can ship camera-only (posters are photographed) and defer gallery import, or add the dep.
- **Date parsing — verify:** no `chrono-node`/`chrono` in deps; chrono is EN-centric → plan hand-rolled per-locale regex (EN+FR first) on `dayjs` (already a dep, locales already imported in `src/utils/i18n.ts:5-12`).

## Implementation (files to touch/create, ordered steps)
0. Dependencies: add OCR lib (verify choice above); optional `expo-image-picker`. Update `app.config.ts` camera-permission string.
1. Create `src/services/ocr/textRecognition.ts` — thin mockable wrapper: `recognizeText(imageUri) → { blocks: [{text, frame}] }` (frame needed for font-size heuristics); `hasOcr` capability check mirroring `hasExpoCamera`.
2. Create `src/features/scan/parseScannedText.ts` — **pure TS, fully unit-testable**: input = blocks + locale (`settingsStore.language`) → `ScannedEventDraft`.
   - Date/time: regex tables per locale (FR `12 juin`, `12/06`, `19h30`; EN `June 12`, `7:30 PM`); month-name lists for the 9 app languages; ambiguity: prefer dates ≥ today, else nearest future.
   - Title: largest-height block or first line not consumed by date/location heuristics (strip common noise: "free entry", ticket URLs).
   - Location: line matching address patterns (street tokens per locale, postal code, "salle/venue/hall").
   - Duration: start-only → dtend = +1h (mirrors `EventForm` default `EventForm.tsx:75`); detected end time → real dtend. All-day words ("all day", "journée") → allDay.
   - Leftover text → `description` (truncated, see step 4).
3. Create `app/event/scan.tsx` + `src/features/scan/` components (`ScanScreen`, `ExtractionPreview`): permission gate (reuse `useQrCameraPermissions` pattern from `modules/zxing-scanner/src`), capture → OCR → preview → navigate.
4. Prefill plumbing: `app/event/new.tsx` currently reads only `date` param (:18). Two options — (a) serialize a JSON `initial` param (expo-router params are strings; size-limited), (b) **preferred**: ephemeral zustand draft store (`src/stores/scanDraftStore.ts`) set by scan screen, read + cleared by `new.tsx`. `EventForm` already accepts `initialValues: InitialValues` (summary, calendarId, allDay, dtstart, dtend, description, location, attendees, rrule, alarms — `EventForm.tsx:22-33`), used by `app/event/edit/[uid].tsx:74-120` → **zero EventForm changes needed**.
5. Entry point: extend `CalendarFab` with optional `onLongPress`/secondary action, or wrap its `onPress` in `app/(tabs)/calendar/index.tsx` to open a `Sheet` with "New event" / "Scan a poster" rows (`event.scanPoster` i18n key).
6. Wire navigation: scan preview "Create event" → `router.push('/event/new')` after setting draft store; `goBackOrHome` already handles exit (`navigationGuard.ts`).

## Data model / types
- `ScannedEventDraft` (new, in `src/types/index.ts` or `src/features/scan/types.ts`): `{ summary?, dtstart?, dtend?, allDay?, location?, description?, confidence: 'low'|'medium'|'high', rawText? }` — subset of `EventForm`'s `InitialValues` + metadata.
- `TextBlock` `{ text: string; frame?: {x,y,w,h} }` — wrapper output shape, lib-agnostic.
- `scanDraftStore` (zustand, non-persisted): `{ draft: ScannedEventDraft|null, setDraft, consumeDraft }`.
- No WatermelonDB schema change; no server/API types; `CreateEventInput` (`src/types/index.ts:74-89`) untouched — `useCreateEvent` (`useMutateEvent.ts:197`) consumes the form's normal submit.

## Edge cases & error handling
- Camera permission denied → explanation screen + "Open Settings" link (pattern exists in `QrLoginScanner.tsx`); gallery-only alternative if dep added.
- OCR unavailable (module missing, e.g. stale dev-client) → `hasOcr` check hides the sheet entry entirely; never crash.
- Empty OCR / no date found → preview shows raw text + "No details detected — fill manually" → empty form.
- Multiple dates on poster (multi-day festival, "from X to Y") → take first future date as start; put all detected dates into `description` for manual fix. Verify: multi-day → allDay range vs. keep v1 simple.
- Past dates ("January" poster scanned in March → assume next January? no: prefer the *nearest future* matching date; show it in preview for correction).
- Timezone: interpret in device TZ (form default); all-day poster dates → `allDay` to avoid TZ drift.
- Huge text dumps → cap `description` (~2 000 chars) to keep nav/store payload sane.
- Low confidence → still navigate, but preview sheet flags uncertain fields per-field.
- Image retention: delete temp capture after recognition; never write to WatermelonDB/media library.

## Tests (jest / tsc / emulator — needs device camera)
- jest: `parseScannedText.ts` matrix — FR/EN fixtures (poster text blocks with frames), multi-date, no-date, time-only, all-day, location patterns, description truncation. Pure function → no mocking needed.
- jest: `new.tsx` draft consumption (mocked store), `textRecognition` wrapper mocked; `Sheet` entry-point render (`__tests__/components/CalendarFab.test.tsx` exists as precedent).
- `tsc --noEmit`; i18n key completeness across the 9 locale files (existing `__tests__/i18n/` pattern).
- Emulator/device: ML Kit does not run in Expo Go — requires `expo run:*`/EAS build; test camera permission flow, real posters FR+EN, low light, rotated text, gallery path if added. e2e (maestro, `e2e/`) can cover the navigate-to-prefilled-form path with a stubbed draft.
- No CalDAV/server test needed (client-only feature; `testcontainers` suite untouched).

## Docs & i18n
- USER_GUIDE.md: "Create an event from a poster" section (entry point, privacy note "on-device OCR, images never uploaded", review-before-save, supported languages EN/FR first).
- README feature line; changelog entry; note in plan docs that this is [mobile+] (no web parity).
- i18n: new `scan.*` keys in all 9 `src/locales/*.json` (title, capture, retake, extracting, preview labels, "no details detected", privacy line); FR/EN month-name tables inside `parseScannedText.ts` keyed by `settingsStore.language`, fallback EN.

## Open questions / arbitration notes
- **[mobile+] superset arbitration required** — no web parity; must land via a Discussion/epic (#382 decides if section-D features get a dedicated Discussion); tracking #383.
- OCR lib choice unverified: `@react-native-ml-kit/text-recognition` vs `@infinitered/react-native-mlkit-*` (Nitro — dep already present) vs custom `modules/text-recognition` (project has the precedent and the Gradle wiring). Decide after SDK-57 compat check.
- FR date parsing: no mature FR chrono — hand-rolled regex is the honest v1; adding `chrono-node` anyway helps EN ("next Friday 8pm") at ~1 extra dep — verify bundle cost.
- Entry point UX: FAB-press sheet vs. long-press vs. calendar top-bar icon — needs a mockup; a sheet slows down the single-tap create flow (arbitration).
- Gallery import (photo of a flyer received by message) needs `expo-image-picker` — v1 scope call.
- Confidence thresholds & which fields go to `description` vs. dropped — tune on real posters; v1 errs on "put it in description".
- Business cards: name/phone/email ≠ event — v1 treats them as low-confidence posters; a dedicated "add contact" path is out of scope.
