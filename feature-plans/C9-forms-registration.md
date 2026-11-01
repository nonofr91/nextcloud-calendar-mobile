# C9 — Registration link via Forms

> Scope tag: [ecosystem] | Effort: S | Targets: new epic candidate | Tracking: #383

## Goal & UX

Attach a Nextcloud Forms **public** link to an event ("S'inscrire"/RSVP), by picking one of the
user's existing forms. The link is appended to the event **description** — not LOCATION (LOCATION
is reserved for maps/Talk, `useEventLocation`/`TALK_URL_PATTERN` `src/utils/caldav-parse.ts:13,96`),
and no dedicated ICS field: `URL:` is not parsed today (verify: `caldav-parse.ts` has no `url` prop
handling) so it would be invisible in-app. Attendee side is already covered: description is linkified
and tappable (`app/event/[uid].tsx:163,333-342`, `src/utils/linkify.ts:35`).

Minimal path (recommended): form picker → resolve/create its public share → append
`\n\nRegistration: {publicUrl}` to `EventForm`'s description state. The write path (`useMutateEvent`
`resolveLocationAndDescription` `src/features/event/hooks/useMutateEvent.ts:124-136`,
`buildIcs` `src/utils/ics.ts:134-164`) needs **no change** — description already flows through, and
edit round-trips via `initialValues.description` (`app/event/edit/[uid].tsx:80`).

Fuller path (create a registration form with name/email fields — `POST /forms` + `PATCH` title +
2× `POST questions` type `short` + share) is **deferred**: 4+ chained calls, form-lifecycle
questions (naming, cleanup), effort M. Re-evaluate after the minimal path ships.

## Upstream dependencies & capability gating

- **verify: spec endpoint wrong for half the fleet.** `GET /ocs/v2.php/apps/forms/api/v2.4/forms`
  only works on Forms 4.x (`routes.php` stable4: legacy requirement `v2(\.[1-5])?`). Forms 3.x
  accepts only `v2`/`v2.1`; Forms 5.x removed v2 entirely — only `/api/v3` routes exist.
- Correct gating: `capabilities.forms = { version, apiVersions }` in the OCS capabilities response
  — `['v2','v2.1']` (Forms 3), `[...'v2.5','v3']` (Forms 4), `['v3']` (Forms 5). Extend
  `fetchServerCaps` (`src/services/nextcloud/nextcloud.ts:79-99`, mirrors `'spreed' in apps` check)
  to derive `formsApiVersion: 'v3' | 'v2.1' | null` (prefer v3, fallback any v2.x → use v2.1 legacy
  routes, which Forms 3/4 both serve). Consume via `useAccountStore` like `TalkToggle.tsx:17`.
- Endpoints (all under `{baseUrl}/ocs/v2.php/apps/forms`, `OCS-APIRequest: true`,
  `Accept: application/json`, `trustedFetch` `src/services/shared/trustedFetch.ts:139`):
  - List: `GET /api/v3/forms` (v3) / `GET /api/v2.1/forms` (legacy) → condensed
    `{id, hash, title, expires, permissions[], state?}` (`state` v3-only: 0 active/1 closed/2 archived).
  - Shares: `GET /api/v3/forms/{formId}` / `GET /api/v2.1/form/{id}` → `shares[]`; a link share has
    `shareType: 3` (`IShare::TYPE_LINK`) and `shareWith` = the public hash.
  - Create share: `POST /api/v3/forms/{formId}/shares` body `{shareType:3, permissions:['submit']}`
    (empty `shareWith` → server generates a 24-char token, HTTP 201). Legacy v2.1:
    `POST /api/v2.1/share` with `{formId, shareType:3, permissions:['submit']}` — verify body shape.
- Public URL: `{baseUrl}/apps/forms/s/{shareHash}` (route `page#public_link_view`, Embedding.md).
  Internal `/apps/forms/{hash}` requires login — **not** usable for public RSVP.
- Admins can forbid link shares (`allowPublicLink` → OCS 403 on share creation) and restrict form
  creation — surfaced as picker errors.

## Implementation (files to touch/create, ordered steps)

1. `src/types/index.ts:93` — `ServerCapabilities += formsApiVersion?: 'v2.1' | 'v3'`; default
   `undefined` in `src/stores/accountStore.ts:17`; extend `fetchServerCaps` to read
   `ocs.data.capabilities.forms.apiVersions`.
2. `src/services/nextcloud/forms.ts` **(new)** — `basicAuth` copy (pattern `sharees.ts:5`),
   `fetchForms(account, api) → FormSummary[]` (filter `state !== 0` when present +
   `expires !== 0 && expires*1000 < now`), `ensurePublicLink(account, api, formId) → publicUrl`
   (GET full form → reuse `shareType===3` share → else POST share). `maxRetries: 0` best-effort.
   verify: whether OCS needs the `index.php` fallback like `sharees.ts:29-34` (unlikely — `ocs/v2.php`
   is explicit — flag "verify on live instance").
3. `src/features/event/components/FormsLinkField.tsx` **(new)** — capability-gated row (returns
   `null` when `formsApiVersion` unset, TalkToggle pattern); `Select` (`src/ui/components/Select.tsx`)
   or `Sheet` listing forms fetched lazily on open; subtitle per row "public link" unknown until pick
   → single full-form fetch on selection; spinner + error states.
4. `EventForm.tsx:401` — render `<FormsLinkField>` after `<TalkToggle>`; `onPick(url)` →
   `setDescription(d => d.includes(url) ? d : d + '\n\n' + t('event.registrationLinkLabel') + ': ' + url)`.
   No `CreateEventInput`/`useMutateEvent`/`ics.ts` changes needed.
5. Attendee/read side: nothing — linkify covers it.

## Data model / types

```ts
// types
type FormsApiVersion = 'v2.1' | 'v3';
ServerCapabilities = { talkEnabled: boolean; calendarApp: CalendarAppStatus;
  formsApiVersion?: FormsApiVersion };
// services/nextcloud/forms.ts
interface FormSummary { id: number; title: string; expires: number; state?: number }
interface FormShare { id: number; formId: number; shareType: number; shareWith: string }
const FORMS_LINK_SHARE_TYPE = 3; // OCP\Share\IShare::TYPE_LINK
```

No WatermelonDB/model changes; the link is plain description text.

## Edge cases & error handling

- Forms absent/old API → capability null → field hidden (progressive enhancement).
- Zero owned forms → picker empty state + optional "open Forms in browser" (`{base}/apps/forms/`).
- Shared-to-me forms: link-share creation needs ownership → list `?type=owned` only (v3) /
  owned list (v2.1 default is owned already; `shared_forms` is a separate endpoint — do not merge).
- Expired/closed/archived forms filtered; `expires` is unix seconds, `0` = never.
- Duplicate attach (edit screen already contains the URL) → `includes` guard above.
- Admin-disabled public links → share POST 403 → toast `common.errorPermission`-style message;
  form keeps working, only link creation fails.
- Offline/slow → `trustedFetch` timeout 20s + `maxRetries:0`; picker shows retryable error, submit
  is unaffected (link attach is best-effort, never blocks event save).
- Multiple link shares on one form → take the first `shareType===3`.

## Tests (jest / tsc / emulator)

- `__tests__/services/nextcloud/forms.test.ts` **(new)** — mock `globalThis.fetch` (jest.setup.js:23
  bridges `nativeTlsTrust` → `fetch`, pattern `sharees.test.ts`): v3 vs v2.1 URL selection, OCS
  `ocs.data` unwrapping, reuse existing share vs POST create (assert single POST, shareType 3,
  `permissions:['submit']`), 403 propagation, expired/closed filtering, URL format `/apps/forms/s/`.
- Extend/cover `fetchServerCaps` parsing: `forms.apiVersions` → `formsApiVersion` (`undefined`,
  `['v2','v2.1']` → `'v2.1'`, `['v3']`/`['v2.5','v3']` → `'v3'`).
- `tsc --noEmit`; jest suite. Emulator: on a live instance — pick a form without a public share →
  link created + inserted; pick one with a share → reused; submit → tap link in event detail.

## Docs & i18n

- 9 locale files (`src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`), keys under `event.*` beside the
  `talk*` block (~line 145): `registrationLinkLabel` ("Registration"), `registrationPickForm`,
  `registrationNoForms`, `registrationCreatingLink`, `registrationError`, `registrationLinkHint`
  ("A public link is created if the form has none").
- `README.md` — new bullet next to "Nextcloud Talk Integration" (README.md:111): attach a Forms
  registration link; note "requires Nextcloud Forms app".

## Open questions / arbitration notes

- **Auto-create vs ask**: creating a link share is a server-side mutation on a user-owned form;
  recommend creating it silently at pick time + hint text (matches "attach a registration link"
  intent) — arbitrate in #383 if an explicit confirm is wanted.
- verify on live Forms 3.x: legacy `POST /api/v2.1/share` body (`formId`+`shareType`+`permissions`
  array) and whether the response returns `shareWith` directly.
- ICS `URL:` property instead of description text: standards-correct but invisible in-app (no parse
  today) — worth revisiting if a detail "link" row is ever added; description is the pragmatic choice.
- Fuller path (form creation with name/email questions, `POST /forms` + questions + share): defer to
  a follow-up issue; effort M.
- Should the detail screen badge a `/apps/forms/s/` link like `talkUrl` (`caldav-parse.ts:96`)?
  Proposal: no — generic linkify is enough; a dedicated button duplicates C3's talkUrl pattern only
  if user feedback asks for it.
