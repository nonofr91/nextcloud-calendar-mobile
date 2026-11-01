# B7 — Calendar export (OCS + client fallback)
> Scope tag: [upstream] | Effort: S | Targets: epic #250 | Tracking: #382

## Goal & UX
"Export calendar" per-calendar action → produces a full-calendar `.ics` → opens the
system share sheet (save to Files / send to another app). Mirrors the web calendar's
"Download" entry. Placement proposal: an "Export" section in the account settings
screen (`app/(tabs)/settings/account/[id].tsx`, already loads `useCalendarsFromDb`,
line 35) listing each exportable calendar with a share icon + per-row busy state —
fits epic #250 (Calendar Management) and the per-calendar section A1 phase-2 also
extends. Secondary option: share icon/long-press in `CalendarDrawerRow.tsx` — arbitrate.

## Upstream dependencies & capability gating
- **OCS (NC ≥35, server#55178, merged Aug 2026 — verified in master source)**:
  `POST {base}/ocs/v2.php/calendar/export`
  (`apps/dav/lib/Controller/CalendarExportController.php`,
  `#[ApiRoute(verb:'POST', url:'/export', root:'/calendar')]`; openapi path confirmed
  in `apps/dav/openapi.json`). Body JSON: `{target: <calendar URI>, type: 'ical',
  options?: {rangeStart: string, rangeCount: int}}`; header `OCS-APIRequest: true`.
  Response 200 = **raw stream** `text/calendar; charset=UTF-8` (NOT OCS-wrapped JSON);
  400/401 = OCS JSON `{ocs:{meta,data:{error}}}`. `#[UserRateLimit(limit:1,period:60)]`
  and `#[TokenScope(CALENDAR_READ)]` — **verify** app-passwords from login-flow v2
  carry the scope.
- `target` = calendar URI = our `CalendarMeta.slug` (server resolves via
  `getCalendarsForPrincipal(principal, [$calendarId])` — occ arg is named `uri`).
- `options.rangeStart`/`rangeCount` = **UID-cursor pagination**
  (`CalDavBackend::exportCalendar`: `uid > rangeStart ORDER BY uid ASC LIMIT n`) —
  chunked export possible but each chunk is a separate VCALENDAR → merging needs
  wrapper stripping. Phase 2 at most.
- **No dedicated capability flag** — `apps/dav/lib/Capabilities.php` unchanged →
  gate on `ocs.data.version.major >= 35`, same detection as A7 import. Requires
  `fetchServerCaps` (`src/services/nextcloud/nextcloud.ts:79-99`) to also parse
  `json.ocs.data.version.major` (today only `capabilities.spreed`).
- **Fallback for older servers — simpler than spec's multiget concat**: sabre's
  `ICSExportPlugin` is registered unconditionally in `apps/dav/lib/Server.php:209`
  (NC subclass adds `REFRESH-INTERVAL`), so `GET {calendar.url}?export` streams a
  full VCALENDAR on **every** supported NC — this is the web "Download" link.
  → the client-side multiget fallback is **not needed**; note for completeness:
  `fetchEventsByHrefs` (caldav.ts:497) discards raw ICS via `parseIcsObjectsAsync`,
  so a raw variant would be required anyway, plus whole-calendar-in-memory cost.
- Subscribed calendars (`isSubscribed`): not a `caldav:calendar` resourcetype →
  neither path applies; export = re-fetch `calendar.sourceUrl` (pattern at
  caldav.ts:358-367).

## Implementation (files to touch/create, ordered steps)
1. `src/types/index.ts:93` — `ServerCapabilities += serverMajorVersion: number`
   (0 = unknown); default in `src/stores/accountStore.ts:17`; parse in
   `fetchServerCaps` (nextcloud.ts:91-95).
2. `src/services/nextcloud/calendarExport.ts` **(new)** —
   `exportCalendarOcs(account, calendar)` POST JSON via `trustedFetch`
   (`OCS-APIRequest:true`, `Accept` not needed — stream), `maxRetries:0`;
   `exportCalendarDav(account, calendar)` GET `${calendar.url}?export`;
   `exportCalendar(account, calendar, caps)` dispatcher: subscribed → `sourceUrl`
   GET; `caps.serverMajorVersion >= 35` → OCS, on HTTP 400/404 → auto-fallback to
   `?export`; else `?export`. Return `{ filename: <slugified displayName>.ics, ics }`.
3. `src/features/calendar/utils/exportAndShare.ts` **(new)** — write
   `Paths.cache` file + `Sharing.shareAsync(file.uri, {mimeType:'text/calendar',
   dialogTitle, UTI:'public.calendar-event'})`. **Deps**: `yarn add expo-file-system
   expo-sharing` — fs@57 already in tree transitively; `expo-sharing` is new native
   code → requires dev-client rebuild (no OTA). verify: SDK-57 `File`/`Paths` API
   names (`new File(Paths.cache, name).create().write(ics)` vs `writeAsStringAsync`
   legacy).
4. `app/(tabs)/settings/account/[id].tsx` — "Export" section: `List` of
   `!isSubscribed || sourceUrl` calendars (deck/tasks/RO/birthday included — read
   access suffices), trailing `IconButton` (Share icon) + busy flag; on error
   `Alert` + `describeMutationError` (errors.ts:41 — 429 branch exists).
5. Optional phase 2: "Save to Nextcloud Files" → PUT
   `remote.php/dav/files/{davUserId}/{folder}/{name}.ics` — arbitrate.

## Data model / types
- `ServerCapabilities.serverMajorVersion: number` (accountStore default `0`).
- No WatermelonDB / `CalendarMeta` change. Local type `ExportResult = { filename: string; ics: string }`.
- Filename: `slugify(displayName) || slug` + `.ics` (sanitize `/`, whitespace, unicode).

## Edge cases & error handling
- OCS rate limit 1 req/60s → dedupe taps, disable row while in-flight; 429 surfaces
  via `HttpError.retryAfter` → `errorRateLimitedRetry`.
- OCS 400 "calendar not found / export not supported" → silent `?export` fallback;
  401 → `errorAuth`. `?export` failure → `describeMutationError`.
- Read-only/shared/deck/task/`contact_birthdays` calendars: export = read → allow;
  collection exports all component types (VTODOs included, matches web).
- Subscribed calendar: uses `sourceUrl`; failure = generic network error.
- Memory: `trustedFetch` carries body as base64 native→JS (`trustedFetch.ts:95-110`);
  a large calendar is held 2–3× in RAM — flag for very big calendars; the OCS
  `rangeStart`/`rangeCount` chunking is the mitigation (phase 2, requires VCALENDAR
  de-wrap/re-wrap).
- Empty calendar → valid VCALENDAR (VERSION/PRODID [+REFRESH-INTERVAL via `?export`]).

## Tests (jest / tsc / emulator)
- `__tests__/services/nextcloud/calendarExport.test.ts` **(new)**: OCS URL+method+
  JSON body+`OCS-APIRequest` header; `?export` URL; dispatcher matrix
  (major≥35→OCS, <35→DAV, subscribed→sourceUrl, OCS-400→DAV fallback);
  429 → `HttpError` w/ retryAfter; non-2xx → throw.
- Extend `__tests__/api/nextcloud.test.ts`: capabilities fixture with
  `ocs.data.version.major` → `serverMajorVersion`; absent → 0.
- `yarn tsc --noEmit`; jest suite (mock = `globalThis.fetch` via TlsTrust mock,
  jest.setup.js:23-48).
- Emulator/device matrix: NC32+34 (`?export` path) vs NC35 (OCS path), incl. shared
  + subscribed calendar; real share sheet needs a device (expo-sharing).

## Docs & i18n
- Keys ×9 locales (`src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`):
  `settings.account.export*`, `calendar.exporting`, `calendar.exportFailed`
  (reuse `common.error*`), share `dialogTitle`.
- README.md feature list + "requires NC35 for OCS path / all versions via CalDAV";
  note expo-sharing dep. Update proposals doc + epic #250 / tracking #382.

## Open questions / arbitration notes
- Is the OCS path worth it given `?export` covers all versions? Pros: upstream API,
  jcal/xcal, non-DAV providers, UID-cursor chunking. Simpler alternative = `?export`
  only (effort shrinks to XS). Spec asks OCS-first — arbitrate in #382.
- UI placement: settings section (proposed) vs drawer row vs event-detail menu.
- "Upload into Nextcloud Files" — in scope or phase 2 (extra PUT + folder picker)?
- `expo-sharing` adds a native dep (rebuild); alternative RN `Share.share` is
  iOS-only for file URLs → confirmed insufficient for Android.
- verify: `TokenScope(CALENDAR_READ)` on export vs our login-flow-v2 app password —
  if scoped tokens predate this, an old app password could 401 → message exists.
- verify: NC35.0.x patch level where export landed (merged Aug 14, 2026 — check
  changelog; import/export may ship in 35.0.x minor rather than 35.0.0).
