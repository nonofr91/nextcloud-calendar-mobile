# C4 — Invite a circle/team

> Scope tag: [ecosystem] | Effort: S | Targets: epic #251 | Tracking: #382

## Goal & UX

Let the attendee picker surface **groups**: Nextcloud teams (circles backend, rebranded
"Teams" in Contacts 8.8/8.9) and Contacts **contact groups**, both already reachable
server-side. UX parity with the web editor: group results appear in the suggestion list
with a team icon + member count ("n members"), tapping adds a `CUTYPE=GROUP` attendee and
optionally expands resolvable members into individual attendees (web behavior, PR
calendar#5420). Rooms/resources are **excluded** — B1 owns them via a different API.

## Upstream dependencies & capability gating

- **verify**: the attendee endpoint (`contact#searchAttendee`,
  `apps/calendar/v1/autocompletion/attendee`) returns `type: 'individual' | 'contactsgroup'`
  only — circles are NOT in this response. Web fetches circles separately via
  `GET /ocs/v2.php/apps/files_sharing/api/v1/sharees?search=<q>&itemType=pringroucipals
  &perPage=200&format=json` → `ocs.data.circles` + `ocs.data.exact.circles`
  (`{label, value.circle.{id,population,owner.instance}}`).
- Member resolution endpoints (calendar app): `GET /apps/calendar/v1/circles/getmembers?
  circleId=<id>` and `POST /apps/calendar/v1/autocompletion/groupmembers`.
- Gating: no capability flag; web uses initial-state `isCirclesEnabled`. Mobile: probe the
  sharees call — absent/empty `circles` keys (circles/teams app off or enumeration
  disabled) → silently skip. **verify** on NC34/35 whether `itemType` or result shape
  changed for teams.
- ICS format (per web): `ATTENDEE;CUTYPE=GROUP;CN=<name>:mailto:circle+<id>@<instance>`;
  members written as `ATTENDEE;...:mailto:<m>` (+ `MEMBER="mailto:circle+..."` param —
  needs A1 param preservation; without it, flag acceptable degradation).

## Implementation (files to touch/create, ordered steps)

1. `src/services/nextcloud/sharees.ts` — `parseContactEntry` (line 54): also accept
   `type==='contactsgroup'` (carry `members` count; emails arrive `mailto:`-prefixed).
   Dedup map (line 131) keyed per `kind+email` so a group and a user sharing an email both
   survive. New `fetchCircles({account, query, limit})` hitting the files_sharing sharees
   OCS endpoint (`trustedFetch`, `OCS-APIRequest`, `Accept: application/json`,
   `maxRetries:0`); **verify** `index.php` prefix need (`ocs/v2.php` usually works bare).
   New `fetchGroupMembers({account, circleId | groupEmail})` wrapping both member endpoints.
2. `src/types/index.ts` — extend `ShareeResult`-side types (see below) and `Attendee` with
   `cutype?: 'INDIVIDUAL' | 'GROUP'`.
3. `src/features/event/hooks/useContactSuggestions.ts` — in `fetchForQuery` (line 50-94)
   `Promise.all([fetchSharees, fetchCircles])`, merge circle results; on cache-fallback
   path circles are absent (acceptable, mark "verify").
4. `src/features/event/components/AttendeesField.tsx` — suggestion `Item` (line 87-95):
   leading `Users`/`UsersRound` lucide icon instead of `ContactAvatar` when `kind!=='individual'`;
   description = member count or circle instance. `addAttendee` (line 30-41): for groups,
   push `{email: groupUri, displayName, cutype:'GROUP'}`; show the web-parity info toast
   "members are invited but not synced"; if expansion enabled (step 6), await
   `fetchGroupMembers` then `dedupeAttendees` the member list in.
5. `src/utils/ics.ts` `attendeeLines` (line 95-100): emit `CUTYPE=${att.cutype ?? 'INDIVIDUAL'}`.
   `src/utils/caldav-parse.ts` `readAttendees` (line 59-72): capture `cutype` parameter so a
   group row survives a re-edit round-trip.
6. Member expansion: MVP = circle stored as GROUP attendee + members resolved and added as
   individuals (parity). `MEMBER=` param write is deferred to A1 (attendee-param
   preservation, R2 fix) — note dependency, do not hand-roll.
7. `src/utils/attendees.ts` `dedupeAttendees` — unchanged (email key still unique:
   `circle+id@instance`); verify group rows with empty email keep `!key` passthrough.

## Data model / types

```ts
export type ShareeKind = 'individual' | 'contactsgroup' | 'circle';
export interface ShareeResult {
  id: string;            // email, or `circle:<id>` / `group:<email>`
  kind: ShareeKind;      // default 'individual'
  displayName: string;
  email: string;         // mailto-stripped; circles: `circle+<id>@<instance>`
  source: ShareeSource;
  photoUrl?: string;
  members?: number;      // contactsgroup `members` / circle `population`
  circleId?: string;     // needed for getmembers
}
export type Attendee = { email: string; displayName?: string;
  cutype?: 'INDIVIDUAL' | 'GROUP' };
```

`filterContacts` (contactCache.ts:51) haystack uses `contact.email` — guard `?? ''`.
Contacts cache stores individuals only; circles/groups fetched live per query.

## Edge cases & error handling

- Circle with federated/remote members: `getmembers` returns only resolvable local emails —
  add GROUP attendee anyway (matches web).
- Teams app disabled / enumeration off → sharees returns no `circles` key → silently skip.
- `contactsgroup` entries dropped today by `type!=='individual'` filter — now surfaced;
  verify email value shape (`mailto:group%40group` in old tests is a stub, not real data).
- Non-mailto ATTENDEE values (`urn:`) — `readAttendees` keeps raw value; `attendeeLines`
  would re-prefix `mailto:` → restrict group handling to `circle+*@*` URIs, flag "verify".
- Typed-email path (`AttendeesField.tsx:37-39`) unchanged.
- Re-saved events: without A1, `PARTSTAT/ROLE` still reset — C4 must not regress further;
  CUTYPE must round-trip.
- Errors from the extra endpoints: best-effort, degrade to individuals only (never block
  the picker).

## Tests (jest / tsc / emulator)

- Extend `__tests__/services/nextcloud/sharees.test.ts`: `contactsgroup` parsed with
  `members`; `individual`+group same-email dedup; new `fetchCircles` OCS shape incl.
  `exact.circles`, failure meta → `[]`; `fetchGroupMembers` both routes.
- `__tests__/utils/attendees.test.ts` (check exists — else new): GROUP attendee dedup.
- `__tests__/utils/ics.test.ts`: `attendeeLines` writes `CUTYPE=GROUP` + CN.
- `__tests__/utils/caldav-parse.test.ts`: parse `ATTENDEE;CUTYPE=GROUP:mailto:circle+x@y`
  → `cutype:'GROUP'`; edit→rebuild round-trip preserves it.
- `useContactSuggestions` test: merged circles+contacts, circle error → contacts only.
- `tsc --noEmit`; jest. Emulator (NC34/35 + Teams): search "team", add circle, save, verify
  on web the GROUP attendee + members, re-edit event mobile.

## Docs & i18n

- 9 locales `src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`: `event.attendeeGroupMembers`
  ("%n members"), `event.attendeeTeam` badge/label, `event.circleInviteNotice` (parity with
  web "members of circles get invited but are not synced yet").
- `USER_GUIDE.md` attendees section: team/group invite + expansion note + NC34/35 Teams
  requirement. README feature line if it lists attendee search.

## Open questions / arbitration notes

- **verify**: does `files_sharing/api/v1/sharees` also return NC user `groups`
  (`ocs.data.groups`) — worth a third `kind:'group'` or out of scope? Propose out (web
  doesn't offer it); arbitrate in #382.
- **verify**: NC34/35 teams still expose the circles sharee type vs a new `teams` key.
- Spec premise correction: server does **not** expand circle members on iTIP — the web
  resolves + adds members client-side. Plan mirrors that; flag "verify" on a live iTIP.
- MEMBER param write depends on A1 (PARTSTAT/param preservation, `ics.ts:95-100`) — land
  C4 after or alongside A1 to avoid a second ATTENDEE rewrite.
- Rooms/resources intentionally out — coordinate B1 (epic #254, `room-building-*`).
