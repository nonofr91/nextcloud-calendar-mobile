# C2 — Complete VTODO task support (recurrence, subtasks, tags)
> Scope tag: [ecosystem] | Effort: M-L | Targets: issue #45, PR #284, epic #256 | Tracking: #382

## Goal & UX
Finish what PR #284 (branch `feature/tasks-45`, 5 commits on merge-base f02292c) started.
The POC already: parses STATUS/COMPLETED/PERCENT-COMPLETE (`taskIsCompleted`,
`src/utils/vtodo.ts`), renders completed styling + a "Mark completed" button on
`app/event/[uid].tsx`, toggles via `useToggleTask` (`src/features/event/hooks/useMutateTask.ts`)
and gates visibility behind Settings → Calendar → "Show completed tasks".
C2 adds: (a) recurring tasks — Tasks 0.18 writes RRULE on VTODO but `parseVtodo`
hard-codes `isRecurring: false` (caldav-parse.ts:233); (b) subtasks via
`RELATED-TO;RELTYPE=PARENT`; (c) CATEGORIES chips/filter; (d) VALARM already read
via `alarmMinutesList(vtodo)` (:234 — confirmed); (e) completion semantics done in
POC; (f) a real VTODO write path (POC has toggle only — no create/edit; `canEdit`
excludes tasks in `app/event/[uid].tsx`).

## Upstream dependencies & capability gating
- No Tasks-app capability exists — VTODOs ride the existing bounded `VTODO`
  calendar-query REPORT (`fetchEvents`, caldav.ts:373-384). Returned VTODOs = feature
  detection.
- `fetchCalendars` already parses `supported-calendar-component-set` (caldav.ts:235-244)
  but only tests `name="VEVENT"` → add `supportsTodos` (`name="VTODO"`) to gate
  create/edit UI; toggling an existing task stays ungated.
- verify: Tasks 0.18 recurrence semantics — per-occurrence completion via
  RECURRENCE-ID VTODOs, or DTSTART/DUE advanced on complete? Inspect real ICS from a
  Tasks 0.18 instance before choosing write semantics.
- verify: undated VTODOs — RFC 4791 matches them in every time-range, but
  `parseVtodo` drops them (`if (!anchor) return undefined`, :200) → invisible today;
  decide an "undated" placement or accept the drop.

## Implementation (files to touch/create, ordered steps)
0. Rebase `feature/tasks-45` onto `dev` first: schema conflict — the branch adds task
   columns at v8, but dev already ships v8 (`calendar_order`) and v9 (`is_shared`)
   → move to `toVersion: 10` (migrations.ts, schema.ts). Branch also predates the
   `MAX_ITERATIONS` bound (caldav-parse.ts:20) — keep dev's version.
1. `src/utils/caldav-parse.ts` — `parseVtodo` (:189):
   - Read `rrule` (`toICALString()`, mirror :278-282), `related-to` (RELTYPE=PARENT →
     parent uid; verify what Tasks 0.18 actually emits), `categories` (comma-split),
     `priority`.
   - Skip VTODOs carrying `recurrence-id` and collect them as exceptions (mirror
     :260-266) — today every VTODO subcomponent emits a same-uid row → duplicates.
   - Expansion: extract the VEVENT block (:302-363) into a shared helper. For VTODO
     wrap `new ICAL.Event(vtodo)`; verify: `ICAL.Event.endDate` reads `dtend`/
     `duration` only, NOT `due` (node_modules/ical.js/dist/ical.js:9325-9340), and
     `startDate` = dtstart only → DUE-only recurring tasks need iteration on a cloned
     component with synthetic DTSTART=DUE, then map slots back to due-anchored
     dtstart/dtend (duration = DUE−DTSTART when both exist, else
     DEFAULT_TODO_DURATION_MS :22).
   - Occurrences get `${uid}_occ_${slot}` + `recurrenceId` + `isRecurring:true`, task
     fields propagated; a vtodo variant of `exceptionFields` (:84) applies STATUS/
     COMPLETED overrides from RECURRENCE-ID VTODOs.
   - Fallback if expansion proves unstable: phase 1 ships flag-only (`isRecurring`,
     `rrule` — the Repeat row on detail already keys off `isRecurring`).
2. `src/utils/vtodo.ts` (POC) — add `setVtodoDates`, `setVtodoCategories`,
   `setVtodoRelatedTo` reusing the `rewriteBlock` line-edit pattern (preserves
   X-props/VALARM like `setVtodoCompleted`), plus `buildVtodoIcs({uid, summary,
   dtstart?, due?, status, categories, relatedTo, alarms?, rrule?})` for create.
   No `extractExtraVeventLines` VTODO equivalent exists (:415 is VEVENT-only) —
   line-rewrite is the preservation strategy.
3. `src/types/index.ts` — POC fields + `taskParentUid?: string`,
   `taskCategories?: string[]`, `taskPriority?: number`; `supportsTodos?: boolean`
   on CalendarMeta.
4. DB — schema v10 columns `task_status`, `task_completed_at`, `task_percent`,
   `task_parent_uid`, `task_categories` (JSON); migrations.ts; models/Event.ts;
   observedColumns.ts; mappers/event.ts; sync.ts `writeEvent`/`eventUnchanged`;
   eventWrites.ts `applyPatch`. **Fix POC bug**: `useEvents.ts` `rowKey` (:11-34)
   lacks task fields → fingerprint swallows toggles → list views stay stale
   (`useEventByUid` is unaffected — no fingerprint there).
5. `useMutateTask.ts` (POC) — add `useUpdateTask` (due/categories/percent/parent)
   and `useCreateTask` (`putEvent` + optimistic insert); gate create on
   `supportsTodos` / `calendarGroup()==='tasks'` (utils/calendars.ts:10-15).
6. UI — subtasks: indent under parent in AgendaView/MonthDayView + "Subtask of X"
   row on detail; categories: chips on task rows + drawer/settings filter;
   recurring: Repeat row + strike-through per occurrence.

## Data model / types
- Reuse `recurrence_id`, `is_recurring`, `rrule` columns — no per-type split;
  `href`+`uid` remain the keys.
- `taskCategories` JSON string column; `taskParentUid` plain string (no FK — the
  parent may be unsynced/out-of-range).
- Occurrence rows inherit the master's task fields; per-occurrence completion has
  no persistence model until write semantics are arbitrated.

## Edge cases & error handling
- `alarmTriggerMinutes` anchors absolute TRIGGER on `dtstart` (:35) → on DUE-only
  tasks `triggerToMinutes` gets a datetime → alarm silently dropped; anchor on
  `due` or document.
- Tasks with `alarms === undefined` inherit global default reminders via
  `alertTimes` (alerts.ts:67-81) — decide if intended.
- Recurring toggle: `setVtodoCompleted` rewrites the whole VTODO → completes the
  series. Until semantics are arbitrated, allow toggle only on the master/
  non-recurring tasks.
- Undated VTODOs dropped (see gating) — log a count so invisible tasks are
  diagnosable.
- Deck boards (`app-generated--deck`, supportsEvents:false, range-only sync at
  sync.ts:287) emit card VTODOs — keep `isTask` badge, no toggle
  (read-only guard already in `useToggleTask` via `event.readOnly`).

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/utils/caldav-parse.test.ts`: RRULE VTODO expands (DTSTART-anchored and
  DUE-only), RECURRENCE-ID VTODO merges as override, EXDATE honored,
  MAX_OCCURRENCES/MAX_ITERATIONS bounds kept; POC task tests already landed there.
- `__tests__/utils/vtodo.test.ts` (POC): extend to new rewriters + buildVtodoIcs
  round-trip (build → parse → toggle → re-parse).
- Migration: dev v9 install → v10 (the v8 collision is the rebase trap).
- rowKey fingerprint: toggle changes fingerprint → range list re-renders.
- `yarn tsc --noEmit`. Emulator vs Tasks 0.18 on real NC: web-created recurring
  task → occurrences visible; mobile toggle → web agrees; subtask + categories
  round-trip.

## Docs & i18n
- POC already ships `task.*` + `calendar.showCompletedTasks` in all 9 locales; add
  `task.subtaskOf`, `task.categories`, `task.recurring`, `task.new`, `task.due`,
  `task.noDate` in en + fr es pt it nl de ru oc.
- Update `nextcloud-feature-proposals.md` C2 status; note in #382 that no Tasks-app
  capability exists (pure CalDAV detection).

## Open questions / arbitration notes
- Recurring-completion write semantics (shift dates vs RECURRENCE-ID exception vs
  complete-master): biggest unknown — needs real Tasks 0.18 ICS inspection.
- Categories surface: drawer filter (proposed) vs dedicated task-list screen —
  the latter is larger scope, needs arbitrage.
- Task create/edit form: minimal fields in C2 (summary+due) or defer? Proposing a
  "new task" variant of `app/event/new.tsx` (VEVENT-only today).
- Undated tasks: hidden (current) vs "No date" agenda section.
- Deck cards: keep read-only badge vs fold into C1.
