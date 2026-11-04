# PR #3 — Spoken day briefing ("Listen to my day") — Windows emulator evidence

**PR:** https://github.com/nonofr91/nextcloud-calendar-mobile/pull/3
**Branch:** `feature/spoken-briefing` → base `dev` (head `db042b6`)
**Scope:** D9 tier 1 of epic #383 — headphones button in the calendar top bar reads the
displayed day's agenda aloud (TTS), with a floating mini-player. 100 % local, works offline.
**Device:** Windows 11 emulator `ncm-api36` (Pixel 7, Android 16 / API 36, WHPX)
**Server:** local `nextcloud:34-apache` container + Calendar 6.6.4, seeded `E2E` calendar
**Build:** release APK built on the PR branch (`just e2e-build-auto` → clean, `expo-speech`
is a new native dep), installed via `adb install -r -d` (versionCode downgrade)
**Date:** 2026-11-04

## Static checks (on the PR branch)

| Check | Result |
|---|---|
| `yarn tsc --noEmit` | ✅ clean |
| `yarn jest` — feature suites (`briefing`, `speakAlert`) | ✅ 77/77 |
| `yarn jest` — full suite | ✅ 1177/1178 — only the known `caldav-parse` perf flake (<3000 ms bound under machine load); unrelated to the PR |
| Gradle `assembleRelease` | ✅ `BUILD SUCCESSFUL in 21m` → `app-release.apk` (51.7 MB) |

Note: 4 Jest suites intermittently failed with `EPERM rename` on the Windows transform cache
(antivirus file lock, environmental) — all pass with `--no-cache`.

## Functional validation on the emulator

Seeded day: `E2E seed` (all-day) + `Team meeting` 4:18–5:18 PM @ Room Atlas +
`Event number 1/2/3`. Flow: `e2e/maestro/doc/pr3-spoken-briefing.yaml` (all steps COMPLETED).

| Step | Screenshot | Result |
|---|---|---|
| Day view, 🎧 button in top bar | `win-01-day-listen-button.png` | ✅ `calendar-listen` present |
| Tap 🎧 → briefing starts | `win-02-briefing-speaking.png` | ✅ `briefing-bar` shows *"At 4:18 PM: Team meeting, for o…"* — natural time + title + duration phrasing |
| Pause | `win-03-briefing-paused.png` | ✅ toggle flips to ▶ — Android segment-boundary emulation works |
| Resume | `win-04-briefing-resumed.png` | ✅ re-speaks the interrupted segment (⏸ back) |
| Next | `win-05-briefing-next.png` | ✅ skips to *"At 6:23 PM: Event number 1…"* |
| Stop | `win-06-briefing-stopped.png` | ✅ bar disappears |
| Deep link `nextcloud-calendar://listen` | `win-07-deeplink-autolisten.png` | ✅ `am start` intent → `autolisten=1` → briefing auto-starts (home-widget path) |

## Real TTS verified in logcat

The mini-player is not just UI — the Google TTS engine was actually synthesizing:

```
I GoogleTTSServiceImpl: Synthesis request for locale eng-USA and name en-US-language
I GoogleTTSServiceImpl: TTS dispatch: en-us-x-iog-seanet-embedded
```

(emulator/app in English → `en-US` voice; `speechText` selects the voice matching the
generated script language.)

## Known limitations / not covered here

- Speaker output not audible in screenshots — proved via logcat TTS activity instead.
- Notification "Écouter" action (D11-a) and home-widget button (D11-b) exist in the PR;
  the deep-link target they share (`/listen` → `autolisten`) is validated above.
- Full `just e2e` Jest+container suite is flaky on this 16 GB host (container dies under
  memory pressure) — unrelated to the PR; the focused Maestro scenario above is deterministic.

## Verdict

**PASS** — the feature works end-to-end on a real Android release build: listen button,
spoken briefing of the displayed day, working pause/resume/next/stop mini-player, and the
`nextcloud-calendar://listen` deep-link entry point, all with real TTS synthesis.
