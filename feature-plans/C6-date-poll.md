# C6 — Date poll creation (Polls app)

> Scope tag: [ecosystem] | Effort: L | Targets: new epic candidate (epic #254 adjacent) | Tracking: #383

## Goal & UX

Fallback for "free-busy doesn't work" — external attendees whose calendars can't be queried
(`availabilities[].available === false` / no suggestions): create a Polls-app `datePoll` from the
candidate `SuggestedSlot`s, add a public share, hand the user the link.

Flow: find-time sheet → multi-select candidate slots → "Create poll" → result sheet with
**Insert into description** / **Share link…** / **Copy** / **Open poll**. Results are viewed on the
poll web page — no native poll rendering (per spec). "Insert" appends `Poll: <url>` to EventForm's
`description` state (`EventForm.tsx:85` dev / `:89` on find-time branches), same shape as the Talk
precedent (`resolveLocationAndDescription`, `useMutateEvent.ts:127-136`) — no ICS writer change
needed, `textLines` escapes it (`src/utils/ics.ts:68-74`).

Touchpoints: `FindTimeSuggestSheet.tsx` on `feature/find-time-ux-v2` (suggestion list,
`upcomingSuggestions`, `handlePick` ~line 98 — natural multi-select host); `FindTimeSheet.tsx` on
`feature/find-time-229` (`onApplySlot` prop ~line 27, `useFreeBusy` already returns `suggestions`,
`useFreeBusy.ts:188`). Implement on whichever of PR #231/#310 merges first; rebase the other.

## Upstream dependencies & capability gating

- Polls REST v1.0 — **verify per server**: Polls ≥8/9 exposes OCS only (`openapi.json` on
  `nextcloud/polls@main`): base `{base}/ocs/v2.php/apps/polls/api/v1.0`, header
  `OCS-APIRequest: true` + `Accept: application/json` + Basic auth (app password, `basic_auth`
  scheme). Legacy docs (`docs/API_v1.0.md`, Polls ≤7) used `/index.php/apps/polls/api/v1.0`
  (polls#4125) — decide OCS-only vs 404 fallback probe.
  - `POST /poll` `{type:'datePoll', title}` → 201 `ocs.data.poll.id`.
  - `POST /poll/{pollId}/option` `{option:{timestamp, duration}}` per slot (unix s, duration s).
  - `POST /poll/{pollId}/share/{type}` with `type='public'` → `ocs.data.share.{token,URL}`; public
    page `{base}/apps/polls/s/{token}` — **verify** returned `URL` field vs constructing it
    (doc's sample embeds `index.php`, pretty-url installs differ).
  - Optional `PUT /poll/{pollId}` `{pollConfiguration:{description, allowMaybe, useNo, showResults}}`.
- Capability: add `pollsEnabled` to `ServerCapabilities` (`src/types/index.ts:91-94`). Detection in
  `fetchCapabilities` (`nextcloud.ts:101`): `'polls' in capabilities` (`fetchServerCaps`, :79-99 —
  **verify** polls registers a capability) and/or navigation-apps `id==='polls'` — generalize
  `fetchCalendarApp` (:57-77) to scan the one response it already downloads for both ids. Default
  `false` (`accountStore.ts:17`); consume like `TalkToggle.tsx:17-19`.
- Auth: `trustedFetch` (`src/services/shared/trustedFetch.ts:139`) + `Authorization: Basic` — the
  private `basicAuth` is already copied 3× (nextcloud.ts:5, talk.ts:14, branch freeBusy.ts) —
  extract to `src/services/shared/` or duplicate once more (flag).
- Share/copy/open: RN core `Share.share({message})` (no `expo-sharing` dep), `Clipboard` from
  expo-clipboard (precedent `app/event/[uid].tsx:88`), `Linking.openURL` (`openTalkRoom.ts:129`).

## Implementation (files to touch/create, ordered steps)

1. `src/services/nextcloud/polls.ts` **(new)** — `pollsRequest` wrapper (OCS headers, Basic,
   `httpErrorFrom` `errors.ts:29`, check `ocs.meta.statuscode` like `talk.ts:37-41`);
   `createDatePoll`, `addPollOption`, `addPublicShare` → `{pollId, url}`; orchestrator
   `createDatePollWithOptions` (sequential options).
2. `src/types/index.ts` — `ServerCapabilities += pollsEnabled`; defaults `accountStore.ts:17`,
   fixtures `accountStore.test.ts:11,27`, `syncWidget.test.ts:81`.
3. `nextcloud.ts` — extend navigation-apps/caps check → `pollsEnabled`.
4. `src/features/event/hooks/useCreatePoll.ts` **(new)** — state machine
   (idle/creating/options i-of-n/done/error) → `{url, pollId}`.
5. `FindTimeSuggestSheet` (v2) — "select for poll" mode: checkboxes on suggestion rows, footer
   Button "Create date poll (n)" gated on `pollsEnabled` && ≥2 slots. On 229 sheet: footer entry
   using top-N `suggestions` (simpler; no per-slot selection).
6. Result dialog `PollLinkSheet` **(new)** or `Alert.alert` buttons (`openTalkRoom.ts:167-182`
   precedent): Share / Copy / Open / Insert → `onInsertPollLink(url)` →
   `setDescription(d => d ? `${d}\n\nPoll: ${url}` : `Poll: ${url}`)`; wire prop through EventForm
   (`FindTimeSheet` usage ~line 413-430 on branch).

## Data model / types

```ts
ServerCapabilities += pollsEnabled: boolean;
type PollShare = { token: string; url: string };
type PollResult = { pollId: number; share: PollShare };
// SuggestedSlot{start,end} -> option { timestamp: start/1000, duration: (end-start)/1000 }
```

No WatermelonDB table — the poll is a server object; the link persists only inside the event's
DESCRIPTION.

## Edge cases & error handling

- `pollsEnabled` false or legacy base 404 → entry hidden; optional fallback probe (verify).
- OCS `meta.statuscode` ≠ 200/201 inside HTTP 200 → throw with `ocs.meta.message` (talk.ts precedent).
- Partial option failure → abort + `DELETE /poll/{pollId}` cleanup, toast; never leave ghost polls.
- Share 403 → admin disabled public shares (`AppPermissions.publicShares`) → dedicated message.
- All-day events: datePoll options are timed → hide poll action for all-day (verify Polls support).
- Timestamps are absolute UTC — voters see their own tz; no client TZ mapping needed.
- `describeMutationError` (`errors.ts:41`) for toasts; modest `maxRetries` in the options loop.

## Tests (jest / tsc / emulator)

- `__tests__/services/nextcloud/polls.test.ts` **(new)**: request paths/headers/bodies,
  poll→options→share chain, statuscode-in-200 error, cleanup on partial failure.
- capabilities test: `pollsEnabled` via navigation-apps and via `'polls'` cap; defaults false.
- `useCreatePoll` hook test; `tsc --noEmit`; jest suite.
- Manual/emulator: real NC + Polls — create poll, open link, vote as guest, insert into event.

## Docs & i18n

- 9 locale files (`src/locales/*.json`): `event.findTimeCreatePoll`, `findTimePollSelect`,
  `findTimePollLinkTitle`, `findTimePoll{Share,Copy,Open,Insert}`, plus reuse `common.error*`.
- README/USER_GUIDE find-time section: "requires Polls app; results open on the web".

## Open questions / arbitration notes

- **verify**: OCS-only vs `/index.php/` base on deployed Polls versions (≥8 = OCS per openapi.json).
- **verify**: `'polls'` capability exists, or navigation-apps is the only detection signal.
- **verify**: use `share.URL` as returned vs building `{base}/apps/polls/s/{token}`.
- Slot source on the 229 timeline UI (no suggestion list rendered) — propose top-N `suggestions`.
- Poll lifecycle: created poll persists server-side even if the user discards the link — document.
- [ecosystem] scope → needs its own Discussion/epic before implementation (workflow rule); sequence
  vs #254-adjacent work (B1/B2) to arbitrate in tracking #383.
