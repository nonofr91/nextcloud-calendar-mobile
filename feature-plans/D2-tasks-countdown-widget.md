# D2 — Tasks / countdown widgets
> Scope tag: [mobile+] | Effort: M | Targets: issues #270/#327/#331, PR #333-adjacent | Tracking: #383

## Goal & UX
Two new home-screen widget variants reusing the existing snapshot→MMKV→native pipeline:
(a) **Next tasks** — upcoming VTODO deadlines (Tasks-app calendars + `app-generated--deck` boards),
rows = title + due label ("Today", "J-2", "overdue") + calendar color; tap → task/event deep link.
(b) **Countdown** — "J-42 · Event title" for one user-pinned event; tap → `eventDeepLink(uid)`.
(c) Next-event compact: SKIP — already covered by `CalendarSmallWidget`, iOS `systemSmall` and the
three accessory families (`homeWidget.ios.tsx`, `app.config.ts:120-135,141-177`).
Config stays in-app (existing pattern, `WidgetCalendarSettings`): a "Widget" settings section with
a pin-event picker and a tasks toggle — no Android `configure` activity, no iOS
`AppIntentConfiguration` (neither exists today; per-instance config would double the effort).

## Upstream dependencies & capability gating
- Widget infra is already on `dev` (`src/features/widget/`); month widget (PR #333) is **unmerged**
  on `feat/month-widget` — same files touched (`widgetStore`, `readEvents`, `homeWidget.android`,
  `app.config.ts`) → order/rebase coordination required; PR #319 fixes it further.
- Tasks data on `dev`: `caldav.ts:383` already REPORTs VTODO; `parseVtodo` (`caldav-parse.ts:189`)
  stores them in `events` with `is_task` (`schema.ts`, `Event.ts:32`). Deck boards
  (`supportsEvents:false`, `caldav.ts:240`) are still synced (`sync.ts` `rangeOnly` path) and
  grouped via `calendarGroup` (`utils/calendars.ts`). **Missing on dev**: `task_status`,
  `task_completed_at`, `task_percent` — only on `feature/tasks-45` (PR #284, open). Without them a
  "next tasks" list shows completed items → gate completion-filtering on #284, or ship v1 showing
  all anchored VTODOs (misleading — not recommended). Raw ICS is **not** stored → no fallback parse.
- Recurring VTODO (Tasks 0.18 RRULE): `parseVtodo` ignores RRULE → single anchor occurrence (R3).
- verify: prompt claims "#331 reports widgets not updating" — actually #331 = event→task read-only;
  real staleness issues are #327 (open, per-calendar toggles not applied on iOS) and #218 (closed).
  Ensure new variants reuse the same refresh triggers so #327's fix covers them too.

## Implementation (files to touch/create, ordered steps)
1. `src/features/widget/core/types.ts`: add `TaskItem{uid,title,dueIso,color,calendarId,deepLink,state}`,
   `TasksSnapshot{generatedAtIso,locale,scheme,tasks[]}`, `CountdownSnapshot{uid,title,color,targetIso,daysLeft,deepLink}`.
2. New `src/features/widget/core/tasksSnapshot.ts`: query `events` where `is_task` (+ `account_id`,
   `end >= today` window like `readUpcomingEvents`, `readEvents.ts:29-41`), filter
   `hiddenCalendarIds` + `widgetDisabledCalendarIds`, sort by due, cap ~8 rows, label via i18n.
3. New `src/features/widget/core/countdownSnapshot.ts`: read `countdownEventUid` from
   `useSettingsStore`; fetch event by uid (any future `start`); compute `daysLeft` with zoned
   day keys (reuse `zonedKey`/midnight logic from `agendaSnapshot.ts:47,154`) to avoid off-by-one.
4. `src/features/widget/storage/widgetStore.ts`: keys `widget.tasks.v1`, `widget.countdown.v1`
   + read/write helpers (same JSON pattern as `writeAgendaTimeline`, :16-32).
5. `src/features/widget/sync/syncWidget.ts:40-50`: also build + write both snapshots each run —
   refresh triggers inherited free (WMDB observe, 60 s tick, AppState, 15-min
   `expo-background-task` `widget-agenda-refresh`, Android `updatePeriodMillis` 30 min).
6. Android: `homeWidget.android.tsx` — dispatch `widgetName` → new `TasksWidget`/`CountdownWidget`
   components (cached-read-then-refresh pattern in `widgetTaskHandler`, :136-152); add
   `CalendarTasksWidget`/`CalendarCountdownWidget` entries in `app.config.ts` widgets[] and trivial
   `RNWidgetProvider` subclasses in `android/.../widget/` (pattern: `CalendarSmallWidget.java` —
   manifest receivers + `res/xml/widgetprovider_*` are plugin-generated; verify plugin emits them).
7. iOS: add `NextcloudTasksWidget`/`NextcloudCountdownWidget` to `expo-widgets` config
   (`app.config.ts:120-135`), new Swift structs beside `NextcloudCalendarWidget.swift`,
   `createWidget` calls + render branches in `homeWidget.ios.tsx`; needs native prebuild/EAS build —
   verify whether the expo-widgets plugin generates the Swift structs from config or files are manual.
8. `src/stores/settingsStore.ts`: persisted `countdownEventUid: string | null` (zustand persist,
   :39-95) — or keep in MMKV next to snapshots to stay readable headless; verify which survives.
9. `src/features/settings/components/WidgetCalendarSettings.tsx`: add tasks toggle +
   "Pin an event" picker (search upcoming events → `Select`); reuse `refreshWidgets()` (:8,24).

## Data model / types
- Snapshots live in shared MMKV (`group.com.soluce.nextcloud-calendar`, App Group) — same store as
  `widget.agenda.v1`; new keys versioned `v1`. Payloads small (≤8 tasks, 1 countdown) — no capacity
  issue vs the 24-entry agenda timeline (`agendaSnapshot.ts:159-189`).
- Tasks = existing `events` rows (`is_task`); `due` maps to `dtend` anchor when no DTSTART
  (`caldav-parse.ts:197-218`). Completion state depends on #284 columns — absent on dev.
- `countdownEventUid` pinned per app (single pin), not per widget instance.

## Edge cases & error handling
- Pinned event deleted or past → countdown shows "Done"/empty + prompt to re-pin; auto-clear pin.
- No tasks / tasks toggle off → empty-state text; Deck boards off → excluded via existing toggles.
- Completed tasks on dev (no status columns) → visible until #284 lands — gating decision (above).
- Midnight rollover for J-x: Android relies on 30-min `updatePeriodMillis` + next app sync; iOS
  bakes per-midnight timeline entries — acceptable drift <1 h; document.
- Multi-account: active account only (same as agenda, `readEvents.ts:30`).
- iOS accessory countdown variant is the cheap reuse path if separate widgets get vetoed.

## Tests (jest / tsc / emulator — widget on-device)
- `__tests__/features/widget/tasksSnapshot.test.ts`: due ordering, overdue/undated handling,
  hidden/widget-disabled filtering, i18n labels, completion filter behind #284 gate.
- `countdownSnapshot.test.ts`: daysLeft at tz boundaries (DST, all-day), missing/past uid.
- `widgetStore` round-trip for both keys; `syncWidget.test.ts`: writes all payloads.
- `homeWidget.android.test.tsx`: `widgetName` dispatch + cached-first render.
- `yarn tsc --noEmit`; jest widget suite; Android emulator: add from picker, pin event → J-x
  renders, task completion on web disappears post-sync (post-#284); iOS sim: gallery + timeline.

## Docs & i18n
- New keys under `widget.*` (`nextTasks`, `daysUntil`, `countdownEmpty`, `noTasks`) and
  `settings.widgets.*` (`pinEvent`, `tasksHint`) — `en.json` + 8 locales (pattern :338-346).
- README feature list (month-widget commit `a3cd770` shows the pattern); update
  `nextcloud-feature-proposals.md` D2 row; comment on epic #383.

## Open questions / arbitration notes
- [mobile+] scope: needs explicit arbitration per rules (D-section) — propose v1 read-only.
- Block "open tasks" filter on PR #284 merge, or ship without completion filtering? Recommend gate.
- Pin storage: settingsStore persist vs MMKV (headless Android handler must read it → MMKV safer).
- New iOS widgets = new app-store build (not OTA) — confirm release timing with #333 batching.
- #327 must be verified fixed for the new variants too (timeline push on settings change).
- Single global pin (proposed) vs per-instance config (AppIntent + ConfigureActivity — effort L).
