# A6 — External calendar subscriptions (.ics)
> Scope tag: [parity] | Effort: M | Targets: issue #84, epic #250 | Tracking: #382

## Goal & UX
Parity with the web: read-only calendars subscribed by URL (holidays, sports teams,
trash pickup) appear in the list and render events the user cannot edit.
**Phase 1 (display) is ~90% already implemented** — `fetchCalendars` detects
subscribed collections and reads `{http://calendarserver.org/ns/}source`
(`src/services/nextcloud/caldav.ts:183,199,226,254`), `fetchEvents` fetches the feed
directly (`caldav.ts:358-371`), and read-only is enforced everywhere
(`utils/calendars.ts:4`, `useCalendarData.ts:64-70`, `app/event/[uid].tsx:76`,
`useEventDrag.ts:79`). Residual Phase 1 = detection hardening + visual distinction.
Phase 2 (manage): subscribe-by-URL via MKCOL + unsubscribe via DELETE.

## Upstream dependencies & capability gating
- None needed: Nextcloud exposes subscriptions in the calendar-home PROPFIND Depth:1
  since ~NC12; server caches feed objects (`WebcalCaching/RefreshWebcalService`), but
  the app intentionally fetches the feed URL itself — fresher data, works when the
  server-side refresh fails.
- verify: exact resourcetype element NC emits for subscriptions — sabre.io docs say
  `{http://calendarserver.org/ns/}subscribed` (not `subscribed-calendar`, which
  `caldav.ts:199` checks first; the broad `includes('subscribed')` fallback catches it).
- verify: whether subscription responses include `current-user-privilege-set` →
  `isReadOnly` derivation (`caldav.ts:229-233`). Harmless either way — `isSubscribed`
  already forces read-only at every gate.
- verify (Phase 2): MKCOL is the real web endpoint (confirmed: web issues `MKCOL
  /remote.php/dav/calendars/{user}/{slug}`, resourcetype `collection`+`cs:subscribed`,
  `cs:source`/`d:href`; NC server logs + sabre.io iCal client docs). Check the web's
  exact prop set — `ical:refreshrate`, `subscribed-strip-*` — in cdav-library.

## Implementation (files to touch/create, ordered steps)
Phase 1 — harden & mark (S):
1. `caldav.ts:199`: tighten detection — match `:subscribed` only inside
   `<*:resourcetype>` (current `chunk.includes('subscribed')` also matches a displayname
   containing "subscribed" on non-calendar nodes). Keep `isSubscribed = detected &&
   !isCalendar` (254).
2. `src/utils/calendars.ts`: add `'subscribed'` to `CALENDAR_GROUPS`/`calendarGroup`
   (before `personal`); update `__tests__/utils/calendars.test.ts:18` which currently
   asserts subscriptions land in `personal`.
3. `CalendarDrawer.tsx:50-55` + `CalendarDrawerRow.tsx:31-40`: new group title key +
   `Rss`/`Link` icon instead of the plain dot (mirror the `Cake` birthday pattern);
   optionally show `sourceUrl` host as row description.
4. Feed-fetch robustness in `fetchEvents` (`caldav.ts:358-371`): catch
   `UntrustedCertError`/`CleartextNotConsentedError` from `trustedFetch`
   (`services/shared/trustedFetch.ts:139-152`) — both are designed for the NC host and
   external feed hosts have no consent UI → currently silent per-calendar failure.
   Minimum: log + surface feed URL in sync error; better: per-host trust/consent prompt.
5. `isSubscribed && !sourceUrl` currently falls back to REPORT (works via server cache —
   verify); keep as graceful degradation.
Phase 2 — manage (M):
6. `caldav.ts`: `createSubscription(account, {displayName, sourceUrl, color?})` — MKCOL
   to `calUrl(account)+{slug}/`; slugify displayName, retry `slug-1`/`slug-2` on 405/409;
   body per step "Upstream" above; raise `timeoutMs` (~40s) — server fetches the feed
   synchronously and may be slow. On 5xx, still re-run `fetchCalendars` (the row may
   exist server-side despite a refresh failure — see NC issue #4232).
7. `caldav.ts`: `unsubscribe(account, calendar)` — `DELETE calendar.url`; then
   `syncCalendars` removes the row + its events automatically (`sync.ts:136-146`).
8. UI: footer row "Add subscription" in `CalendarDrawer` (parity with web "+" menu) →
   new route `app/calendar/subscribe.tsx` (URL input + displayname + color); long-press
   or row chevron on a subscribed calendar → "Unsubscribe" confirm.
9. Optional PROPPATCH `displayname`/`calendar-color` on subscription collections —
   server supports it (`subscriptionPropertyMap`) — defer or include if cheap.

## Data model / types
- No schema change: `is_subscribed`, `is_read_only`, `source_url`, `supports_events`
  columns exist (`database/schema.ts:41-46`, `models/Calendar.ts:16-21`), persisted via
  `sync.ts:42-45`, diffed via `calendarUnchanged` (`sync.ts:85-90`).
- `CalendarMeta.isSubscribed`/`sourceUrl` already typed (`types/index.ts:20-22`).
- Subscribed events get synthetic stable UIDs `sub-{fnv}` (`stableSubscriptionUid`,
  `caldav.ts:335-350`) and shared `href = sourceUrl` — keyed rows stay stable across
  feed UID churn; `deleteMissing` prunes vanished entries (`sync.ts:245-254`).

## Edge cases & error handling
- `webcal(s)://` → rewritten to https (`caldav.ts:359`) ✓. `http://` feeds →
  `CleartextNotConsentedError`; self-signed feeds → `UntrustedCertError` (step 4).
- Feeds needing HTTP auth (`user:pass@host`): `trustedFetch` sends no Authorization —
  verify TlsTrust behaviour; document limitation (same gap as web, calendar#70).
- Feed down/invalid: `fetchEvents` throws → `settleAll` failure; if it's the user's
  only calendar, `syncEvents` throws `N/M fetch(es) failed` (`sync.ts:188-192`) →
  error surface each refresh. Acceptable; prefer keeping last-synced rows (already
  the case — rows only deleted for successfully synced calendars).
- Whole feed refetched + reparsed on every range change (rangeOnly path,
  `sync.ts:287`, unthrottled) — fine for typical feeds; optional If-Modified-Since later.
- Feed VALARMs → local notification scheduling fires where the web stays silent
  (server reminders don't run for subscriptions) — divergence, see open questions.
- MKCOL: duplicate slug → retry suffixes; slow/failed server-side refresh → treat
  201 as success, on error re-list before reporting failure; non-ICS URL → server
  accepts anyway, feed just yields zero events (show "0 events" hint post-subscribe?).

## Tests (jest / tsc / caldav round-trip / emulator)
- Existing coverage to keep green: `__tests__/api/caldav.test.ts:316-328` (source URL
  entity decode), `:672-740` (stable UIDs); `__tests__/database/syncVisibleRange.test.ts`
  (rangeOnly routing + throttle interplay); `useEventDrag.test.ts:82`; `calendars.test.ts`.
- New: detection tightened — fixture with `cs:subscribed` resourcetype, and a
  non-calendar node whose displayname contains "subscribed" → not flagged.
- `calendarGroup` → `'subscribed'`; `byServerOrder` ordering; drawer group renders.
- `createSubscription`/`unsubscribe` unit tests: assert MKCOL body (resourcetype +
  `cs:source` href), slug-suffix retry on 405, DELETE target, post-call re-list.
- `yarn tsc --noEmit`; e2e on real NC: subscribe on web → pull refresh → events show
  + no edit affordances; subscribe/unsubscribe in-app → verify in web UI.

## Docs & i18n
- Keys: `calendar.drawerSubscriptions`, `subscription.add`, `subscription.name`,
  `subscription.url`, `subscription.unsubscribe`, `subscription.error.*` — ×9 locales
  (`src/locales/*.json`), follow `calendar.drawer*` naming (`en.json:69-72`).
- README/docs note: subscriptions are read-only, fetched client-side from the source
  (not via server proxy); http/self-signed/auth-protected feeds unsupported for now.
- Update `nextcloud-feature-proposals.md` A6 status; comment on issue #84.

## Open questions / arbitration notes
- Ship scope: Phase 1 hardening alone arguably closes issue #84's read path — confirm
  whether Phase 2 lands in the same PR or a follow-up (proposed: follow-up).
- Direct feed fetch vs server-cached REPORT: direct is implemented and simpler; the
  cached path exists as fallback — any reason to prefer server proxy (auth feeds)?
- Local VALARM notifications for feed events: web parity says suppress; mobile value
  says keep — arbitrate (leaning: keep, it's a stated mobile+).
- Unsubscribe UX placement: drawer row action vs `settings/account/[id].tsx` calendar
  section — drawer matches web parity more closely.
- `isCleartextAllowed`/cert-trust reuse for feed hosts: reuse existing consent store,
  or feeds always require publicly-trusted TLS (proposed: trusted TLS only, v1)?
