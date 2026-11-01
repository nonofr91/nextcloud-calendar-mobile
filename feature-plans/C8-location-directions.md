# C8 — Directions to event location
> Scope tag: [parity/light] | Effort: S | Targets: epic #251 | Tracking: #382

## Goal & UX
The core action is **already shipped on `dev`** (PR #223, fix #326): `app/event/[uid].tsx`
renders a location row with a Navigation `IconButton` (269-297) calling `openMaps`
(`src/features/map/utils/mapLinks.ts:55` — `geo:`/`maps.apple.com` on platform, iOS
ActionSheet for Google Maps/Waze), plus an OSM `EventMapPreview`→`EventMapSheet`
(WebView/Leaflet, 300-315). Remaining work = spec enhancements:

- **Phase 1 (S):** honor ICS `GEO` / `X-APPLE-STRUCTURED-LOCATION` coords before
  text-parsing/geocoding; keep them preserved on update; drop *stale* geo lines when the
  user rewrites `LOCATION`; always offer Directions for non-virtual locations (maps apps
  can search raw text — `openMaps(location)` already builds `geo:0,0?q=…`).
- **Phase 2 (S→M):** location autocomplete in `EventForm`, preferring a server-side
  provider (`integration_openstreetmap` unified search), fallback direct Nominatim with
  usage-policy caveats; write `GEO` when coords are known.

## Upstream dependencies & capability gating
- `GEO` (RFC 5545) needs no gating — written by Thunderbird/Apple clients, not by the
  NC web (nextcloud/calendar#915 still open → web writes `LOCATION` text only, or an OSM
  map URL when inserted via the Smart Picker, which `parseLocation` already decodes via
  `mlat`/`mlon`/`ll` params).
- Preservation is free: `geo` and `x-apple-structured-location` are absent from
  `WRITER_MANAGED_PROPS` (`caldav-parse.ts:409-413`) → `extractExtraVeventLines` keeps them.
- Autocomplete: web uses the **Smart Picker / reference API**, not a dedicated maps proxy
  (verify: calendar#5583 wired `integration_openstreetmap` search into the editor; #5544
  inline autocomplete is still open). Prefer `GET /ocs/v2.php/search/providers` →
  `/search/providers/{id}/search?term=…` (server-proxied Nominatim, admin-controlled).
  verify: provider id (`integration_openstreetmap`?) and entry shape (`link`/`thumbnail`)
  on a live server. Fallback = existing `geocodeLocation` (direct Nominatim,
  `geocode.ts:158-227`, custom UA + 30-day cache) — OSMF policy discourages autocomplete:
  enforce ≥1 s debounce + ≥3 chars, or disable fallback (arbitration).
- iOS `LSApplicationQueriesSchemes` already whitelists `comgooglemaps`/`waze`
  (`app.config.ts:40`).

## Implementation (files to touch/create, ordered steps)
1. `src/types/index.ts` `CalendarEvent` (51-72): add `geo?: { lat: number; lon: number }`.
2. `src/utils/caldav-parse.ts`:
   - `parseIcsItem` (~271) + `parseVtodo` (~227): read `geo` prop → `geo`. verify: ical.js
     returns `GEO` as array/float pair vs opaque — else regex `prop.toICALString()`.
   - Read `x-apple-structured-location` (VALUE=URI): feed its URI value through
     `parseLocation` (`map/utils/parseLocation.ts`) when `geo` absent; `X-TITLE` param can
     backfill `location` display when LOCATION is empty (verify typical payloads).
   - `exceptionFields` (84-108): read exception-level `geo` alongside `location`.
   - New helper `geoLinesToDrop(extraLines)` or filter `geo`/`x-apple-structured-location`/
     `x-apple-ab-traveltime`/`x-apple-ablabel` inside `extractExtraVeventLines` callers.
3. `src/features/map/hooks/useEventLocation.ts`: signature
   `(location, talkUrl, geo?)`; precedence `geo` → `parseLocation` → `geocodeLocation`.
   GEO works offline — evaluate before the `!online` early return (45-49).
4. `app/event/[uid].tsx`: pass `event.geo` (84); show the Navigation button whenever
   `event.location && !isVirtual` (drop `coordinates` requirement — text search works).
5. WatermelonDB: `schema.ts` → **v10** add optional `geo` string column (`"lat,lon"`,
   mirrors `alarms` JSON-string pattern); `migrations.ts` `toVersion:10` `addColumns`;
   `models/Event.ts`; `sync.ts` `writeEvent` (55-76) + `eventUnchanged` (94-111);
   `mappers/event.ts` `mapEventToShared`; `observedColumns.ts` `EVENT_OBSERVED_COLUMNS`;
   `eventWrites.ts` `applyPatch` (26-41).
6. `useMutateEvent.ts` `useUpdateEvent` (282-305): when `input.location !== event.location`,
   strip geo lines from `preserved` (stale-coords hazard — today they'd be kept verbatim);
   when a suggestion supplied fresh coords, append `GEO:{lat};{lon}` to `extraLines`.
7. Phase 2 — autocomplete: new `src/features/map/hooks/useLocationSuggestions.ts`
   (clone `useContactSuggestions` debounce pattern, `trailingDebounce` ≥400 ms, min 3
   chars); new `services/nextcloud/locationSearch.ts` (search-provider query, cached
   provider discovery per account via `trustedFetch`); `EventForm.tsx` location
   `TextField` (364-378) → suggestion dropdown reusing `AttendeesField` list pattern;
   on pick → `location` = label + stashed `geo` → flows to `input` (`CreateEventInput.geo?`)
   → `buildIcsForInput` `extraLines` `GEO:lat;lon`.

## Data model / types
- `CalendarEvent.geo?: { lat: number; lon: number }` — parsed, not user-edited.
- `CreateEventInput.geo?: { lat: number; lon: number }` — set only via suggestion pick.
- `geo` stored as one `"lat,lon"` string column (avoids two nullable floats).
- ICS: `GEO:lat;lon` written only when `input.geo` set; existing `GEO`/`X-*` props survive
  via `extraLines` unless `LOCATION` changed (then dropped, see step 6).

## Edge cases & error handling
- Stale `GEO` after a location edit → must be dropped or coords mislead (step 6); when
  location unchanged, keep lines verbatim (Apple's structured location travels with it).
- `geo:`/`GEO` lat∈[-90,90], lon∈[-180,180] — reuse `parseCoordPair` bounds (parseLocation:4-15).
- Location = meeting/Talk URL → `isVirtualLocation` suppresses map + Directions (already).
- Offline: `geocodeLocation` skipped today; `GEO`-sourced coords still render (step 3).
- Exception-level `LOCATION` without its own `GEO` inherits master `geo` — acceptable;
  overridden `GEO` wins when present.
- Android has no `canOpenURL` guard — `openURL` failure is swallowed (mapLinks:58); keep.
- Nominatim rate-limit: debounce + min-length mandatory; never query per keystroke.
- Recurring `scope:'this'` override: `buildExceptionIcs` extraLines already receives
  master preserved lines — apply the same geo-drop/refresh rules (useMutateEvent:313-324).

## Tests (jest / tsc / emulator)
- `__tests__/utils/caldav-parse.test.ts`: `GEO:48.8;2.35` → `event.geo`;
  `X-APPLE-STRUCTURED-LOCATION;…:geo:lat,lon` fallback; exception-level GEO; invalid
  ranges → `undefined`.
- New `__tests__/features/map/parseLocation.test.ts` (currently untested util): geo: URI,
  OSM `mlat/mlon`, Google `q=`, raw pairs, URL-in-text.
- `useEventLocation` precedence (mock geocoder): geo > parsed > geocoded; offline w/ geo.
- Update flow: location changed → geo lines removed from `extraLines`; unchanged → kept;
  `input.geo` → `GEO:` line emitted once (no dup with preserved).
- Extend `__tests__/features/map/mapLinks.test.ts` only if URL building changes.
- `yarn tsc --noEmit`; emulator: Thunderbird/Apple-created event syncs → directions use
  stored coords offline; editor suggestion pick → PUT contains `GEO`; re-sync no drift.

## Docs & i18n
- Reuse `event.openInMaps` (10 locales, en.json:97); Phase 2 may add
  `event.locationSuggestion…`/`settings` privacy toggle keys — follow existing naming.
- Privacy note (README/docs): coordinates/geocoding queries may go to OSM Nominatim unless
  a server-side provider is detected.

## Open questions / arbitration notes
- Write `GEO` on create? Web does not (#915) — [mobile+ light]; proposed yes when coords
  are already known (harmless, preserved both ways).
- Autocomplete without a server provider: direct Nominatim w/ strict debounce vs feature
  gated off (OSMF policy) — arbitrate.
- `X-APPLE-STRUCTURED-LOCATION` refresh: replace with `GEO` only, or also rewrite
  `X-TITLE`/URI? Proposed: drop & write `GEO` only (simpler, RFC-valid).
- Directions visibility without resolved coords (proposed: always show when non-virtual
  location exists) — UX call.
