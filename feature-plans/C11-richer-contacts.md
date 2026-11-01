# C11 — Richer contact integration (avatars, contact card)
> Scope tag: [ecosystem] | Effort: S | Targets: epic #251 | Tracking: #382

## Goal & UX
Deeper Contacts tie-in on attendee surfaces. Status on `dev`: the pipeline is **mostly shipped** —
`photo` → `ShareeResult.photoUrl` (`src/services/nextcloud/sharees.ts:48-60`), MMKV contact cache
(`src/services/nextcloud/contactCache.ts`), authed photo fetch + data-URI cache + initials fallback
(`src/features/event/hooks/useContactAvatar.ts`, `ContactAvatar.tsx`, `src/ui/components/Avatar.tsx`),
and avatars already render in the picker **suggestion** list (`AttendeesField.tsx:92`). Remaining:
(a) avatars on **added attendee rows** (`AttendeesField.tsx:100-118`) and the **event-detail attendee
list** (`app/event/[uid].tsx:348-364`, currently initials-only `Avatar` at :357); (b) tapping an
attendee opens its Contacts card (web UI deep link); (c) share this surface with A10 birthdays.

## Upstream dependencies & capability gating
- Autocompletion `apps/calendar/v1/autocompletion/attendee` is unchanged in NC34/35 (impact §3.1).
  No capability gate; endpoint absent → suggestions already degrade to typed emails.
- **verify** on a live server the real shape of `photo`: `parsePhotoUrl` keeps only `https?://`
  (sharees.ts:48-52); `data:` URIs and null are dropped (proven by
  `__tests__/services/nextcloud/sharees.test.ts:274-286`). If NC returns relative paths or `data:`,
  extend parsing (data URIs can render directly — zero extra fetch, privacy-friendly).
- **verify** whether entries expose a contact UID/`id` usable to build a Contacts deep link
  (same open question as B2: is `id` the vCard UID?). If absent, CardDAV lookup is the fallback.
- Contacts web UI URL on Contacts 8.8/8.9 — **verify** route: `{base}/index.php/apps/contacts`
  and deep-link form `apps/contacts/<group>/<contactKey>` where key ≈ `<vcardUid>~<addressbook>`.

## Implementation (files to touch/create, ordered steps)
1. `src/services/nextcloud/contactCache.ts` — add `findContactByEmail(accountId, email)` (exact,
   case-insensitive on `contact.email`; cache stores one `ShareeResult` per email so a contact's
   secondary address resolves too) and `ensureContacts(account)` returning cached list or triggering
   `prefetchContacts` (in-flight dedup exists at :61-83).
2. `src/features/event/hooks/useAttendeeContact.ts` **(new)** — `(account, email) → {contact|null}`:
   sync `getCachedContacts` hit → immediate; miss → one `prefetchContacts` call, re-read, share the
   `activeRef` cancellation pattern of `useContactSuggestions.ts`. No fetch when `account` null.
3. `AttendeesField.tsx:100-118` — render `ContactAvatar` (size ~32) as leading element of added
   attendee rows, contact resolved via step 2; keep remove `IconButton`.
4. `app/event/[uid].tsx:348-364` — per deduped attendee: `useAttendeeContact` → `ContactAvatar`
   replaces `Avatar`; add `Item onPress` (supported, `src/ui/components/Item.tsx:11`) → step 5;
   disabled/`onPress` omitted when no contact match (typed email → initials, non-interactive).
5. `src/features/event/utils/openContactCard.ts` **(new)** — build URL then
   `Linking.openURL(url).catch(() => {})` (pattern `app/event/[uid].tsx:338`). Tier 1 (ship):
   `{baseUrl}/index.php/apps/contacts` (pretty-URL `apps/contacts` fallback if 404 — **verify**
   `pretty links` handling like `sharees.ts:29-34`). Tier 2 (if UID verified): deep link
   `apps/contacts/All contacts/<uid>~<book>`; `book` unknown → **verify** whether Contacts resolves
   `<uid>` alone or default book name (`contacts`).
6. Optional/`verify`: `sharees.ts` — if autocompletion carries `id`/UID/addressbook fields, extend
   `ContactAutocompleteEntry` + `ShareeResult` (`contactKey?`, `userId?` — shared with B2 step 3).
7. Optional/deferred: CardDAV `addressbook-query` REPORT on
   `remote.php/dav/addressbooks/users/<davUserId>/` (EMAIL text-match → vCard href → contactKey) —
   only if step 5/6 cannot produce a deep link; note `davFetch` is private (`caldav.ts:66-78`), a new
   `contacts.ts` would reuse `trustedFetch` + Basic auth.
8. A10 tie-in: no code needed beyond shared pipeline — `contact_birthdays` events carry no
   ATTENDEE/email (`BIRTHDAY_CALENDAR_SLUG`, `caldav.ts:265`); optional name-match avatar/link on
   birthday event detail is fragile → propose defer (open question).

## Data model / types
- `Attendee` (`src/types/index.ts:28-31`) unchanged; `ShareeResult` (sharees.ts:11-17) gains optional
  `contactKey`/`userId` only if verified. No WatermelonDB/schema changes — photos live in MMKV
  (`avatar:contact:<accountId>:<url>`, useContactAvatar.ts:9-11), contacts in `contacts:<accountId>`.

## Edge cases & error handling
- Typed emails / contacts without match → initials fallback already (`Avatar.tsx:12-20,30-45`).
- Cross-host `photoUrl` (federated contact) → `isOwnInstanceUrl` guard blocks authed fetch
  (useContactAvatar.ts:17-20) — credentials never leave the instance; initials shown.
- Eager vs picked-only: current behavior fetches photos for rendered suggestion rows (≤25, bounded);
  extending to detail rows adds one `prefetchContacts` per account session (~KB–100s KB depending on
  contact count — **verify** empty-search response size on a large instance; fallback: targeted
  `fetchSharees({query: email})` instead of full prefetch).
- MMKV growth: avatar cache has no TTL/eviction — photo URL changes orphan entries; propose
  timestamped eviction reuse of `contacts:*:at` pattern or size cap (open question).
- Fetch failures → `failed` Set (module-lifetime) → initials, no retry storms; network/4xx logged.
- `type !== 'individual'` entries (contactsgroup/circle/team) are dropped today (sharees.ts:55) —
  C4 territory, out of scope.

## Tests (jest / tsc / emulator)
- New `__tests__/services/nextcloud/contactCache.test.ts` (or extend): `findContactByEmail` exact /
  case-insensitive / miss / multi-email contact.
- New `__tests__/features/event/useAttendeeContact.test.ts`: cache-hit synchronous, miss→prefetch,
  account-null no-fetch (mock `prefetchContacts`; pattern `useContactSuggestions.test.ts`).
- New `__tests__/features/event/openContactCard.test.ts`: URL building (deep link vs root fallback),
  `Linking.openURL` spy (pattern `openTalkRoom.test.ts:42`), catch path.
- Extend `sharees.test.ts` once live payload verified: `id`/UID → `contactKey`, `data:` photo policy.
- `yarn tsc --noEmit`; jest suite. Emulator vs real NC (Contacts 8.8/8.9): confirm `photo` format,
  avatar loads in suggestion + detail, tap opens the right contact, initials on federated/missing.

## Docs & i18n
- New keys in `src/locales/en.json` + 8 locales: `event.openInContacts` (accessibilityLabel/menu),
  `event.contactCardUnavailable` (toast on open failure) — `event.` section ~lines 95-110.
- Update `nextcloud-feature-proposals.md` C11 (note partial pre-shipped state); post to epic #251 /
  tracking #382; README attendee section if it documents picker behavior — verify.

## Open questions / arbitration notes
- **Biggest unknown — `photo` wire format + entry `id` semantics**: decides URL-only vs `data:`/relative
  support AND whether deep link needs CardDAV (effort jumps S→M if so). Probe one real server first.
- Contact-card target when no contact match: hide press (proposed) vs open Contacts root — arbitrate.
- Should `source:'system'` users without `photo` fall back to `/index.php/avatar/<uid>/96`
  (`useAvatar.ts:31`)? Needs verified `userId` — overlap with B2, propose deferring to B2.
- Avatar cache eviction (TTL/size cap): in-scope small hardening or separate chore? Propose include
  only a timestamp write now, eviction later.
- Birthday→contact name matching (A10 cross-link): fragile, propose explicit defer.
