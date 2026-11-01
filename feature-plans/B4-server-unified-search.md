# B4 — Server unified search (calendar-events provider)

> Scope tag: [upstream] | Effort: M | Targets: issue #294, PR #296, epic #256 | Tracking: #382

## Goal & UX

Complement the local WatermelonDB search (branch `feat/event-search`, PR #296) with the
Nextcloud unified-search **event provider**, so queries also match events the app has not
synced — the main value is **beyond the sync horizon**: local rows only cover
`expansionHorizon(now)` = ±`HORIZON_MONTHS` (18, `src/features/calendar/utils/horizon.ts:1`)
for delta-synced calendars, and the ~3-month `monthRange` window
(`src/features/calendar/utils/range.ts:7`) for subscribed/app-generated ones (cf. issue #308).

UX on `app/search.tsx` (branch): local matches render instantly as today; remote hits appear
in a second group ("On server") below, deduped against local rows. Remote rows show the
calendar name (NC34, server#58697 — **verify**: lands in `subline` or an attribute) and a
cloud badge instead of the color dot when the calendar can't be resolved locally. Tapping a
remote row runs fetch-then-open (below) then navigates to `/event/{uid}` as for local rows.

## Upstream dependencies & capability gating

- Provider listing: `GET {base}/ocs/v2.php/search/providers` (unified search exists since
  NC20, lives in the always-on `dav` app — `EventsSearchProvider`). **verify**: spec says
  `calendar-events`, but code/bug reports show provider id **`calendar`** (and possibly a
  sibling `calendar-tasks`); resolve dynamically from the provider list instead of hardcoding.
- Search: `GET {base}/ocs/v2.php/search/providers/{id}/search?term=…&limit=…&cursor=…`
  → `ocs.data = { name, isPaginated, entries[], cursor }`; entry =
  `{ thumbnailUrl, title, subline, resourceUrl, icon, rounded, attributes }`.
- `resourceUrl` = web deep-link `/apps/calendar/edit/{base64(dav-path)}` → recover the DAV
  href by base64-decoding the last path segment (e.g. `…/remote.php/dav/calendars/u/personal/X.ics`).
  **verify**: watch encoding edge cases fixed in server#55623 (backported stable32) —
  URL-decode the segment before base64, decode, then `absUrl()` against `baseUrl`.
- `attributes`: assoc map since server#46464 — at least `createdAt` = DTSTART unix ts
  (**verify** current keys on a live NC34: `calendarName`, recurrence fields?).
- Gating: extend `fetchServerCaps` (`src/services/nextcloud/nextcloud.ts:79-99`) to also call
  the providers endpoint in `Promise.all` → `ServerCapabilities.eventSearchEnabled`; consumed
  via `useAccountStore((s) => s.capabilities)` (same pattern as `talkEnabled`, default at
  `src/stores/accountStore.ts:17`). Fallback: lazily mark "unsupported" per account in a
  module-level `Map` on 404 so one bad probe doesn't spam requests.
- OCS plumbing copy `sharees.ts`: `trustedFetch` + `OCS-APIRequest: true` +
  `Accept: application/json`; **verify** whether `/ocs/v2.php` needs the `index.php` retry
  pattern used in `sharees.ts:29-34` (attendee endpoint is app-route, OCS core routes
  usually work bare).

## Implementation (files to touch/create, ordered steps)

1. `src/services/nextcloud/unifiedSearch.ts` **(new)** — `fetchSearchProviders(account)`
   returns enabled provider ids; `searchCalendarEvents(account, term, {limit=30, cursor})`
   → `{ hits: RemoteEventSearchHit[], cursor }`; `decodeDavHref(resourceUrl)` helper;
   `maxRetries: 0`, `timeoutMs` default.
2. `src/types/index.ts` — add `RemoteEventSearchHit`; `ServerCapabilities +=
   eventSearchEnabled: boolean`.
3. `src/services/nextcloud/nextcloud.ts` — fold the providers probe into `fetchServerCaps`;
   default `eventSearchEnabled: false` on any error.
4. `src/features/search/remoteSearch.ts` **(new)** — `mergeSearchResults(local:
   CalendarEvent[], remote: RemoteEventSearchHit[])` deduped by absolutized `href` vs
   `CalendarEvent.href` (fallback key `uid`≈filename + `createdAt`≈dtstart), local first;
   `remoteHitToCalendarId(hit, calendars)` → `CalendarMeta` match via calendar-uri suffix.
5. `src/features/search/openRemoteResult.ts` **(new)** — fetch-then-open:
   `fetchEventIcs(account, absHref)` (`caldav.ts:410`) → `parseIcsObjectsAsync` with meta
   `{calendarId, accountId, color}` (unbounded range) → upsert row if absent
   (`prepareCreateEvent`, `src/database/sync.ts:29`; query by `account_id`+`uid` first) →
   return the uid for `router.push('/event/'+uid)`. Recurring: pick the parsed event whose
   `recurrenceId`/`dtstart` matches `createdAt` (occurrence uids use the `_occ_` scheme —
   `seriesBaseUid`, `sync.ts:166`); else base uid.
6. `app/search.tsx` (branch file) — effect on `deferredQuery`: min 2 chars + ~350 ms debounce,
   request-epoch ref to drop stale responses, `Promise.allSettled`-style catch →
   `{status:'idle'|'loading'|'ok'|'error', hits}` state; render a `SectionHeader` "On server"
   group (or cloud-badge rows inside one list — see open question); tap remote row →
   spinner on the row → `openRemoteResult` → navigate; on failure show toast + offer to
   open `resourceUrl` in browser as a degraded path.
7. `src/database/useEvents.ts` — add a non-hook `findEventByUid`/`findEventByHref` helper for
   pre-insert dedupe (branch file already adds `useAllEvents`).

## Data model / types

```ts
type RemoteEventSearchHit = {
  title: string;          // entry.title (summary)
  subline: string;        // formatted date (NC34: may carry calendar name)
  href?: string;          // absolute DAV href decoded from resourceUrl
  resourceUrl: string;    // web deep-link, degraded-open fallback
  calendarUri?: string;   // parsed from href path segment
  startTs?: number;       // attributes.createdAt (unix s)
  attributes: Record<string, unknown>;
};
type SearchResultListItem =
  | { kind: 'local'; event: CalendarEvent }
  | { kind: 'remote'; hit: RemoteEventSearchHit };
```

`ServerCapabilities` adds `eventSearchEnabled: boolean` (default `false`).

## Edge cases & error handling

- Provider absent/disabled (404, not listed, `calendarApp` unavailable) → silent local-only;
  cache "unsupported" for the session — never retry every keystroke.
- Response XML / non-JSON despite `Accept: application/json` → guard `res.json()` try/catch,
  treat as error state, keep local results visible.
- Undecodable `resourceUrl` (no base64 segment, exotic installs) → skip entry (can't fetch).
- Remote hit already in local DB → deduped away (href match); hit in a **hidden** calendar →
  resolve `calendarUri` → `Calendar.id` → apply `hiddenCalendarIds` like local results do.
- Recurring events: NC34 expands occurrences server-side (**verify**); if not, the hit points
  at the master object — fetch-then-open still lands on the right series via `_occ_` pick.
- Out-of-horizon insert: safe — `syncEvents` `deleteMissing` only deletes rows inside the
  synced `[start,end]` window (`sync.ts:245-255`); stray rows may linger if later deleted
  server-side (accepted, documented).
- Rate: debounce + min length + `limit` 30 + epoch-guard; offline/network error → local-only.
- Subscribed-calendar events can appear remotely — dedupe vs `stableSubscriptionUid` won't
  match (different uid scheme) → possible duplicate row; **verify** whether to suppress
  remote hits whose calendarUri resolves to a `isSubscribed` calendar.

## Tests (jest / tsc / emulator)

- `__tests__/services/nextcloud/unifiedSearch.test.ts` **(new)**: providers-list parse,
  entry mapping (assoc vs legacy list `attributes`), base64 href → absolute URL,
  cursor/limit params, 404 → disabled, non-JSON body → clean error.
- Extend `__tests__/features/search/searchEvents.test.ts` (branch) or new
  `remoteSearch.test.ts`: merge dedup by href, fallback by uid+`createdAt`, ordering local-first.
- `openRemoteResult.test.ts` **(new)**: mocked `fetchEventIcs` + in-memory DB → creates row,
  returns uid; existing row → no duplicate; recurring → picks matching occurrence.
- `tsc --noEmit`; jest suite. Emulator/manual: seed server with an event ~3 years back
  (outside ±18-month horizon), confirm it is *not* local, search → remote row appears →
  tap → detail opens; offline → local-only, no crash.

## Docs & i18n

- 9 locale files (`src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`, already touched by the
  branch): keys `search.onServer` (section header), `search.serverSearching`,
  `search.serverError`, `search.openInBrowser`.
- `README.md`/`USER_GUIDE.md` search section (branch already updates it): "server results
  require NC ≥20 unified search + calendar app; finds events outside the synced range;
  NC34 adds calendar names + server-side recurrence expansion".

## Open questions / arbitration notes

- **verify**: provider id is `calendar` in the DAV app, not `calendar-events` as the spec
  states — confirm against `GET /search/providers` on a live NC34 (also check a
  `calendar-tasks` sibling to optionally include VTODO hits).
- **verify**: exact `attributes` keys on NC34/35 (`createdAt` confirmed; calendar-name
  location, `calendarUri`, `recurrenceId`?) — dedup + navigation keys depend on it.
- Merge strategy for #382: (a) two grouped sections "This device"/"Server" (proposed —
  clearest provenance, matches the Penpot v2 grouped-results mockup in epic #256), or
  (b) single interleaved list sorted by date with a cloud badge. Decide with the
  event-search PR author before merging `feat/event-search`.
- Persistence: propose fetch-on-open only (no bulk caching of remote hits) — avoids stale
  rows; arbitrate if offline access to fetched items is desired instead.
- Pagination: fixed `limit=30` vs "load more" via `cursor` — propose fixed for v1.
- Effort check: M holds if `attributes` provide what we need; grows to M+ only if href
  recovery/occurrence matching needs fallbacks (then propose a Phase 2).
