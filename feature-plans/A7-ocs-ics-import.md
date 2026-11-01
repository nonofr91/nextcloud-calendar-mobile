# A7 — ICS import via OCS endpoint
> Scope tag: [upstream] | Effort: S (add-on to #224) | Targets: issue #95, PR #224, epic #250 | Tracking: #382

## Goal & UX
On NC ≥35, one-shot server-side import of a whole `.ics` file: a single
`POST /ocs/v2.php/calendar/import` — server parses, deduplicates by UID and
streams per-object dispositions (created/updated/exists/error). On
`IcsImportScreen` (branch `feature/ics-file-import-95`, `src/features/event/components/IcsImportScreen.tsx`):
keep the existing per-event review flow and add a bulk "Import all" action →
writable-calendar picker → POST → spinner → result summary
(created/updated/skipped/failed) → `syncCalendarDelta` on the target calendar →
`goBackOrHome`. On NC <35 the same "Import all" action runs a client-side PUT
loop over the file's UIDs (duplicates skipped, not failed).

## Upstream dependencies & capability gating
- Endpoint: server#55178, merged 2026-08 → NC35. `POST /ocs/v2.php/calendar/import`,
  JSON `{transaction, target, options:{format:'ical'|'jcal'|'xcal', validation:0|1|2,
  errors:0|1, supersede:bool}, data:'<ics payload>'}` (optional `user`, admin-only — skip).
  200 → `application/x-ndjson` stream: `{type:'control',transaction,disposition:'start'|'end'}`,
  `{type:'count',vevent,vtodo,vjournal}`, `{type:'object',identifier,disposition:
  'created|updated|exists|error',errors[]}` (verified in master
  `apps/dav/lib/Controller/CalendarImportController.php` + `Import/*Event.php`).
  400 → `ocs.data.error` (calendar missing/not writable/deleted/bad options); 401.
  `#[UserRateLimit(limit:10, period:3600)]` → possible 429. `TokenScope CALENDAR_WRITE` → app password OK.
- **No dedicated capability**: master `apps/dav/lib/Capabilities.php` does not
  advertise the import (verified — #55178 did not touch it). Gate on
  `ocs.data.version.major >= 35`: `fetchServerCaps` (`src/services/nextcloud/nextcloud.ts:79-99`)
  already reads the same payload but drops `version`.
- verify: whether a later NC35 minor adds an explicit capability key (watch
  `Capabilities.php`) — prefer key over version if one appears.
- `no-uid-conflict` (server#61659, backported 32.0.13/33.0.7/34.0.2): PUT with an
  existing UID → HTTP **409** + `<d:error><cal:no-uid-conflict><d:href>` (verified
  `apps/dav/lib/Exception/UidConflict.php` extends Sabre `Conflict`). Older NC:
  400 BadRequest text "Calendar object with uid already exists…".
- Trashbin cleaned on same-UID recreation (server#61881) → re-import after
  server-side delete no longer conflicts — transparent benefit, no code.

## Implementation (files to touch/create, ordered steps)
Apply on `feature/ics-file-import-95` (or as follow-up stacked on #224).
1. `src/types/index.ts:93` `ServerCapabilities` + `src/services/nextcloud/nextcloud.ts:91-96`
   `fetchServerCaps`: parse `json.ocs.data.version` → `serverVersionMajor` and
   `ocsCalendarImport: major >= 35`; default in `accountStore.ts:17`.
2. NEW `src/services/nextcloud/calendarImport.ts`:
   `importCalendarOcs(account, calendar, ics): Promise<OcsImportSummary>` —
   `trustedFetch` POST `${baseUrl}/ocs/v2.php/calendar/import`, headers
   `Authorization` (reuse `basicAuth` pattern from nextcloud.ts:5), `OCS-APIRequest: true`,
   `Content-Type: application/json`, `Accept: application/x-ndjson`; body
   `{transaction: Crypto.randomUUID(), target: calendar.slug, options:{format:'ical',
   validation:0, errors:0, supersede:false}, data: ics}`; `timeoutMs` ~60s.
   `target` = calendar URI = `CalendarMeta.slug` (types/index.ts:19).
   Parse response `text()` line-by-line as NDJSON (no streaming reader needed —
   body is buffered anyway) → `{created, updated, skipped, failed:[{uid,error}], total}`.
   On `!res.ok` → read `ocs.data.error`, else `httpErrorFrom` (errors.ts:30).
3. NEW in `src/features/event/utils/icsImport.ts` (or `utils/ics.ts`):
   `splitIcsByUid(ics): {uid, ics}[]` — `ICAL.Component(parseIcsToJcal(ics))`
   (already exported on the branch), group `vevent` by `uid` keeping master +
   `RECURRENCE-ID` exceptions in one VCALENDAR + all `vtimezone` → `toString()`.
   `importEventsViaPut(account, calendar, parts)` — loop `putEvent`; 409/`no-uid-conflict`
   → skipped; other errors → collect `{uid, error}`, continue; return same summary shape.
4. `caldav.ts` `putEvent` (:411-425): on `!res.ok`, read body once, detect
   `no-uid-conflict` (XML element or legacy 400 message) → throw `UidConflictError`
   (new subclass in `services/shared/errors.ts`) so bulk loops and single import
   both map it to "already exists / skipped".
5. `IcsImportScreen.tsx`: "Import all" Item at top of the event list (visible when
   `events.length > 0`) → calendar picker (`!isReadOnly && supportsEvents !== false`) →
   dispatch: `capabilities.ocsCalendarImport ? importCalendarOcs : importEventsViaPut`
   → summary `Alert` → `syncCalendarDelta(account, calendar)` (`src/database/sync.ts:327`)
   → `goBackOrHome`. On OCS 404/400 "unknown" → silent auto-fallback to PUT loop
   (stale capability after mid-session upgrade). Per-event review flow unchanged.

## Data model / types
- `ServerCapabilities` += `serverVersionMajor: number; ocsCalendarImport: boolean`
  (persisted zustand partialize already keeps the whole object — no migration).
- NEW types `OcsImportEvent` (NDJSON union: `control` | `count` | `object`) and
  `OcsImportSummary { created; updated; skipped; failed: {uid?, error}[]; total }`.
- No WatermelonDB/schema changes; imported events enter via normal delta sync.

## Edge cases & error handling
- Rate limit 10 imports/hour → 429: `HttpError.retryAfter` already parsed
  (errors.ts:16-22) → show wait message; never auto-retry (burns the quota).
- `supersede:false` default → duplicates return `exists` = counted skipped.
  verify: whether issue #95 / web expects overwrite-on-import instead → if yes
  expose `supersede` choice; skip matches the per-event "Overwrite?" confirm spirit.
- Partial failure: `errors:0` continues; summary lists failed identifiers.
  Never send `errors:1` (aborts mid-stream, ambiguous state).
- VTODO/VJOURNAL in file: server counts them (`type:'count'`); unsupported
  components yield per-object `error` — surface as failed, verify ImportService
  behaviour on a VEVENT-only calendar (does it error or skip silently?).
- PUT fallback href `${uid}.ics`: same UID under a different filename →
  409 no-uid-conflict = skip; identical filename = overwrite by href — treat as
  "updated", consistent with `eventExists` + overwrite alert (IcsImportScreen).
- Large files: entire ICS inlined in one JSON body + buffered NDJSON — fine for
  typical exports; note multi-MB files as a known limit (no client chunking).
- `transaction` is echoed in every NDJSON line — verify match before tallying;
  serialize imports (one at a time) to keep semantics simple.
- Response when route missing (pre-35 or gated wrong): verify actual status
  (404 OCS vs 400) — drives the auto-fallback trigger.

## Tests (jest / tsc / caldav round-trip / emulator)
- `calendarImport.test.ts` (mocked fetch like `__tests__/api/caldav.test.ts`):
  URL/body/headers; NDJSON → correct tally incl. `exists`→skipped and `error`;
  400 `ocs.data.error` surfaced; 429 → retryAfter.
- `fetchServerCaps` version parsing: `version.major` 34/35 → flag true/false;
  missing `version` → false (never crash).
- `splitIcsByUid`: multi-VEVENT + RECURRENCE-ID stay grouped; VTIMEZONE copied;
  VTODO excluded/handled per decision above.
- `putEvent`: 409 + `<cal:no-uid-conflict>` → `UidConflictError`; legacy 400
  message → same.
- Keep green: `__tests__/features/event/icsImport.test.ts`, `caldav.test.ts`;
  `yarn tsc --noEmit`.
- Emulator/real NC: NC34 → fallback loop (2 events, 1 dup → 1 created/1 skipped);
  NC35 → OCS path same fixture + events visible after `syncCalendarDelta`;
  rapid 11× import → 429 surfaced.

## Docs & i18n
- New `import.*` keys in all 9 locales (`src/locales/*.json`, next to
  en.json:173-186): `importAll`, `chooseCalendar`, `importing`,
  `resultSummary` ({created}/{updated}/{skipped}/{failed} placeholders),
  `errorImport`, `errorCalendarNotWritable`, `errorRateLimited`,
  `skippedDuplicates`, `updatedExisting`.
- Doc note: NC ≥35 single-POST fast path, else per-object PUT; 10 imports/hour cap.
- Update `nextcloud-feature-proposals.md` A7 row; comment on #95, PR #224, #382.

## Open questions / arbitration notes
- Bulk action vs review-first: OCS path cannot edit before saving — keep both
  ("Import all" + per-event rows)? Proposed yes; the per-event row still goes
  through `useCreateEvent`/`putEvent` on every server version.
- `supersede` default: proposed skip-duplicates; web may overwrite — check
  what `calendar:import`/web UI does and match (verify).
- Capability freshness: `useCapabilitiesSync` (`src/hooks/useCapabilitiesSync.ts`)
  skips launch-time refresh (first `account?.id` change only) — a mid-session
  server upgrade stays gated off until refetch; acceptable given the 404→PUT
  auto-fallback, or refetch on import screen mount (cheap, one call).
- Sync scope after import: proposed `syncCalendarDelta` on the target only —
  cheap and sufficient (sync-token picks up server writes); full `syncEvents`
  unnecessary.
