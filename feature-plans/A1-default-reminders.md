# A1 — Per-calendar default reminders
> Scope tag: [parity] | Effort: M | Targets: epic #253, #251 | Tracking: #382

## Goal & UX
Parity with web Calendar 6.5: a calendar can carry server-side default reminders —
`default-alarm-part-day` (timed events) and `default-alarm-full-day` (all-day events),
int minutes before start, plus `disable-alarm-notifications` (bool) — namespace
`http://nextcloud.com/ns` (confirmed in `CalDavBackend::propertyMap`; server#58679, #59517).
Phase 1: read the props in `fetchCalendars`, persist them, and use them as default VALARM
offsets when creating events in that calendar; fall back to local `timedAlerts`/`allDayAlerts`
when absent. Phase 2 (separate PR): write the setting back via PROPPATCH from a
per-calendar edit UI.

## Upstream dependencies & capability gating
- NC34+ only; props absent on older servers → fields stay `undefined` → local fallback.
  Read path needs **no** capability gate (implicit by absence).
- Write path: verify PROPPATCH behaviour on NC<34 (dead property vs 403) — gate the UI on
  "props were returned" or server major from `fetchCapabilities` (currently only parses
  `talkEnabled`/`calendarApp`, `src/services/nextcloud/nextcloud.ts:79-99`).
- verify: plural props `default-alarms-part-day`/`...-full-day` (JSON array of alarms,
  in-flight upstream: server#61832, cdav-library#1066, calendar#8567). Read both, prefer
  plural when present; write only singular ints.
- verify: how the web encodes "None" per calendar (prop removed vs sentinel). If removed,
  "absent" ⇒ local fallback (web itself falls back to its global default — our analogue is
  the local setting, consistent).

## Implementation (files to touch/create, ordered steps)
Phase 1 — read & apply:
1. `src/services/nextcloud/caldav.ts` `fetchCalendars` (body ~168-186): add
   `xmlns:ncc="http://nextcloud.com/ns"` (existing `nc:` is `nextcloud.org` — keep both) and
   request `<ncc:default-alarm-part-day/>`, `<ncc:default-alarm-full-day/>`,
   `<ncc:disable-alarm-notifications/>` (+ optional plural props). Parse prefix-agnostically
   like `calendar-color` (~213-218); normalize int + bool (`'1'`/`'true'`/`'0'`/`'false'`).
2. `src/types/index.ts:12-26` `CalendarMeta`: `defaultAlarmPartDayMinutes?: number`,
   `defaultAlarmFullDayMinutes?: number`, `alarmNotificationsDisabled?: boolean`.
3. WatermelonDB persistence: `src/database/schema.ts` → v10 (3 optional `calendars`
   columns); `src/database/migrations.ts` `toVersion:10` `addColumns`;
   `src/database/models/Calendar.ts` fields; `src/database/sync.ts` `writeCalendar` (34-48)
   + `calendarUnchanged` (78-92); `src/database/useCalendars.ts` `mapCalendarToMeta` (11-27);
   `src/database/observedColumns.ts` `CALENDAR_OBSERVED_COLUMNS`.
4. `src/features/event/hooks/useMutateEvent.ts`: `resolveAlarms(input)` (84-89) →
   `resolveAlarms(input, calendar)`. Precedence: `input.alarms !== undefined` (explicit
   choice; `[]` = None) → `alarmNotificationsDisabled` → `[]` (explicit no-reminder) →
   server default (`[minutes]`) → local fallback (`allDay` ? `allDayAlerts.map(allDayAlarmMinutes)`
   : `timedAlerts`). Thread `calendar` into `buildIcsForInput` (91-116), `eventFromInput`
   (148-177), `expandOccurrences` (179-195), and the `scope==='this'` exception call (~319,
   uses `event`'s calendar). Server values are raw minutes — do NOT route them through
   `allDayAlarmMinutes` (that helper converts *days* to the local 9:00 convention, `alerts.ts:34`).
5. `src/features/event/components/EventForm.tsx:201-205`: `willAlert` (permission prompt)
   resolves the same default for the **selected** calendar.
6. `src/features/notifications/scheduleAlerts.ts:53-63`: `alertTimes` fallback for events
   with `alarms === undefined` should use the event calendar's server default before the
   global one — needs a `calendarId → defaults` map (one `calendars` table read); also union
   `alarmNotificationsDisabled` calendars into the `notifDisabledCalendarIds` filter (58-60).

Phase 2 — write (optional):
7. `caldav.ts`: new `proppatchCalendarDefaultAlarms(account, calendar, {partDay, fullDay})` —
   first PROPPATCH in the codebase; Depth 0 on `calendar.url`, `d:set`/`d:remove` per value;
   then `syncCalendars` refresh.
8. UI: extend `app/(tabs)/settings/account/[id].tsx` calendar section (55-76) or a dedicated
   per-calendar sheet; reuse `AlarmOffsetPicker` in single-value mode for part-/full-day.
   Propose `disable-alarm-notifications` read-only (system flag) — arbitrate.

## Data model / types
- `CalendarMeta` + 3 optional fields (see step 2). `alarms?: number[]` semantics unchanged:
  `undefined` = follow defaults, `[]` = explicit none (`X-NCM-ALARM-NONE`, `ics.ts:76-88`,
  `caldav-parse.ts:45-57`).
- Server stores single int per type → app applies `[minutes]` (one VALARM).
- All-day server value = raw minutes before `DTSTART` (midnight) — web semantics; distinct
  from local `allDayAlerts` which are *days* converted to 9:00.

## Edge cases & error handling
- Response may use any prefix/`self-closing` tags → regex like existing props, tolerate
  missing/empty values; `parseInt` NaN → `undefined`.
- `default-alarm-*` = `0` is meaningful ("at time of event") — keep, don't falsy-drop.
- Events edited in place with no VALARM gain the calendar default VALARM on update — same
  as today's behaviour with local defaults; confirm intended (it materializes the default).
- Shared calendars: props are per-sharee rows server-side → per-user value, safe.
- Subscribed/read-only calendars can't host creation — values inert.
- PROPPATCH failure: keep local field value, surface `httpErrorFrom`, no optimistic write.

## Tests (jest / tsc / caldav round-trip / emulator)
- `__tests__/api/caldav.test.ts` (mocks `globalThis.fetch`): PROPFIND body contains `ncc`
  xmlns + props; 207 fixture with props under arbitrary prefix → fields parsed (int, bool,
  absent, `0`, plural-if-implemented).
- `__tests__/database/syncCalendars.test.ts` (mocks `fetchCalendars` + DB): `writeCalendar`
  persists fields; `calendarUnchanged` detects changed defaults → update op.
- Unit-test `resolveAlarms` precedence (export it or test via `buildIcsForInput`): explicit
  `alarms` > disabled > server default > local fallback; all-day raw-minutes path.
- `__tests__/features/notifications/alertTimes.test.ts`: per-calendar fallback + disabled
  calendar exclusion in `scheduleAlerts` (mock stores/DB).
- `yarn tsc --noEmit`; migration v10 smoke (fresh install + upgrade path).
- Emulator/device vs a real NC34: set per-calendar defaults on web 6.5, sync, create timed
  + all-day events → VALARM offsets match web; NC33 regression → local defaults.

## Docs & i18n
- Phase 1 read-only needs ~0-2 keys (optional hint that per-calendar server defaults apply;
  `settings.alerts.timedHint`/`allDayHint` in `src/locales/en.json` + 8 locales).
- Phase 2: keys for "Default reminder (timed)/(all-day)", per-calendar section title — ×9
  locale files, follow `settings.alerts.*` naming.
- Update `nextcloud-feature-proposals.md` status + mention in epic #253 / tracking #382.

## Open questions / arbitration notes
- Should `alarmNotificationsDisabled` yield `[]` (writes `X-NCM-ALARM-NONE`) or `undefined`
  (no marker) at creation? Proposed `[]` — explicit "none" survives future edits.
- Does web "None" per calendar remove the prop? verify — if a sentinel exists, mirror it.
- Include plural `default-alarms-*` now or when shipped? Read-only support is cheap.
- Apply server default in notification fallback (step 6) — included; drop if scope creep.
- Phase 2 write: also PROPPATCH `disable-alarm-notifications`, or read-only (proposed)?
