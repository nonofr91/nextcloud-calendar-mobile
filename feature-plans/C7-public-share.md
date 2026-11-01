# C7 — Public calendar sharing link
> Scope tag: [parity] | Effort: M | Targets: epic #250 | Tracking: #382

## Goal & UX
Parity with the web Calendar "Share link" publish toggle. On a calendar the user
owns, a share action opens a bottom sheet (`Sheet`, ui/components) showing the
published state: unpublished → "Publish calendar" button; published → the public
link + "Copy link", "Share…" (native `Share.share`), "Copy subscription link"
(`.ics?export`), and a destructive "Unpublish". Entry point: a share `IconButton`
in `CalendarDrawerRow` trailing, only on publishable rows. Copied link is the
human view URL `<base>/apps/calendar/p/<token>`.

## Upstream dependencies & capability gating
- **Wire protocol — verified in `apps/dav/lib/CalDAV/Publishing/PublishPlugin.php`
  (server master) and cdav-library `davCollectionPublishable.js`**: publish is
  NOT a PROPPATCH. It is `POST <calendar.url>` with
  `Content-Type: application/xml; charset=utf-8` and body
  `<cs:publish-calendar xmlns:cs="http://calendarserver.org/ns/"/>` → **202**.
  Unpublish: same POST with `<cs:unpublish-calendar …/>` → **200**.
- Read state: `{http://calendarserver.org/ns/}publish-url` in the calendar-home
  PROPFIND → `<cs:publish-url><d:href><base>/remote.php/dav/public-calendars/
  <token></d:href></cs:publish-url>`, returned **only when published**.
- Gate: `{http://calendarserver.org/ns/}allowed-sharing-modes` → child
  `<cs:can-be-published/>` granted iff non-subscription && `write-acl` privilege
  (sharees can't publish, matching server#65300). If the prop is absent →
  fallback `!isShared && !isSubscribed && !isReadOnly`.
- **Correction to the impact analysis**: server#58897 is an OCP PHP API
  (`ICalendarIsPublic::getPublicToken()`), not a wire prop. `publish-url` has
  been served for years → **no NC-version gate needed**.
- Link shapes (verified): view route `publicView` `/apps/calendar/p/{token}`;
  subscription `<base>/remote.php/dav/public-calendars/<token>?export`.
  verify: servers without URL rewrite need `/index.php/` in the view link
  (calendar#1821/1823) — no detection today; accept pretty-URL, note limitation.
- Public view route lives in apps/calendar → require
  `capabilities.calendarApp === 'available'` (accountStore, index.tsx:42);
  DAV endpoints work regardless.

## Implementation (files to touch/create, ordered steps)
1. `src/types/index.ts` `CalendarMeta` (:12-26): add `publishUrl?: string`
   (raw DAV href) and `canBePublished?: boolean`.
2. `src/services/nextcloud/caldav.ts`:
   - PROPFIND body (:174-185): add `<cs:publish-url/>` +
     `<cs:allowed-sharing-modes/>` (`xmlns:cs` already declared :169).
   - Parse per chunk (near :226): `publishUrl = extractPropHref(chunk,
     'publish-url')` (helper :49-56 handles nested href, prefix-agnostic);
     `canBePublished = /<\w+:can-be-published[\s/>]/.test(chunk)` (child only
     appears in a 200 propstat → safe vs the 404 propstat self-closing form).
   - `publishCalendar(account, calendar)` / `unpublishCalendar`: POST via
     `davFetch` (:66-78); `res.ok` covers 200/202 (trustedFetch.ts:102); else
     `httpErrorFrom(res, ctx)`.
   - Helpers `publicViewUrl(account, cal)` → `${baseUrl}/apps/calendar/p/` +
     `extractSlug(publishUrl)` (:19-26); `publicExportUrl(cal)` →
     `${publishUrl}?export`.
3. WatermelonDB v10: `migrations.ts` `addColumns` `public_url` + `can_be_published`;
   `schema.ts` (:33-49); `models/Calendar.ts` `@field`s; `sync.ts` `writeCalendar`
   (:34-48) + `calendarUnchanged` (:78-92); `useCalendars.ts`
   `mapCalendarToMeta` (:11-27); `observedColumns.ts` CALENDAR_OBSERVED_COLUMNS.
4. `src/features/calendar/components/CalendarShareSheet.tsx` (new): `Sheet` with
   published state, link field, actions; on mutate → service call →
   `syncCalendars(account)` (sync.ts:114) repopulates `publishUrl`.
5. `CalendarDrawerRow.tsx` (:47-69): trailing `IconButton` (lucide `Share2`/
   `Globe`) when `canBePublished !== false && !isShared && !isSubscribed &&
   !isReadOnly` → `onShare`; drill props through `CalendarDrawer.tsx`; local
   `shareTarget` state in `app/(tabs)/calendar/index.tsx` (:225-242).
6. Copy via `expo-clipboard` `setStringAsync` (already a dep, package.json:39);
   Share via RN `Share.share({ message })`.

## Data model / types
- `CalendarMeta.publishUrl` = full `<base>/remote.php/dav/public-calendars/
  <token>` href or `undefined`; token never stored separately (derive via
  `extractSlug`). `canBePublished` optional bool.
- DB columns `public_url` (string, optional) + `can_be_published` (bool,
  optional); cleared when prop absent (unpublished) — `writeCalendar` uses
  `?? undefined` like `sourceUrl` (:44).

## Edge cases & error handling
- POST 403 (sharee/federated without write-acl, or resharing blocked
  server#65300) → `describeMutationError` → `common.errorPermission`.
- 404 on POST (calendar deleted remotely) → `errorNotFound`; trigger a
  `syncCalendars` to drop the row.
- **Token rotation**: unpublish destroys the token; re-publish mints a NEW one →
  old links die. Show an inline warning near Unpublish.
- Publishing task/Deck/birthday collections: server omits `can-be-published`
  (subscriptions) — hidden by the same gate; verify `contact_birthdays`.
- Non-XML POST bodies are ignored by PublishPlugin → always send
  `application/xml`; any other 4xx/5xx → `httpErrorFrom`.
- Offline → `errorNetwork`; the sheet must not optimistically show a link —
  `publishUrl` only becomes truthy after the refetch.
- verify: whether sharees see the owner's `publish-url` (propFind uses node
  publish status) — if so, show read-only "published" state, never actions.

## Tests (jest / tsc / emulator)
- `__tests__/api/caldav.test.ts` (existing fetch-mock): PROPFIND fixture with
  `publish-url` + `allowed-sharing-modes` (arbitrary prefixes) → fields parsed;
  absent prop → undefined; POST publish → method POST + `cs:publish-calendar`
  body + 202 ok; unpublish → 200; 403 → `publishCalendar HTTP 403`.
- `yarn tsc --noEmit`.
- Emulator vs real NC ≥32: publish → link opens anonymously in a browser;
  toggle OFF in web → app sheet shows unpublished after sync; unpublish → link
  404s. Verify `calendar-color`-style propstat-404 chunk doesn't yield a token.

## Docs & i18n
- New `calendar.sharePublic.*` keys + `common.errorPermission` reuse in
  `src/locales/en.json` + 8 locales (fr es pt it nl de ru oc): publish,
  unpublish, copyLink, copySubscriptionLink, linkCopied, publishedHint,
  unpublishConfirm, unpublishWarnToken, errorPublish.
- Update `nextcloud-feature-proposals.md` C7 status; correct the
  `nextcloud-34-35-impact-analysis.md` server#58897 note (OCP API, not wire);
  comment on epic #250 + tracking #382.

## Open questions / arbitration notes
- Entry point: drawer-row icon (proposed, closest to web sidebar action) vs
  long-press vs a per-calendar page under `settings/account/[id].tsx`.
- Offer the subscription `?export`/`webcal` link too (proposed: yes, as a
  secondary action — parity with web "Copy subscription link") or view link only?
- index.php rewrite-less servers: ship pretty-URL only (proposed) or probe?
- Published sharee calendars (see edge) — display-only badge worth it?
