# A9 — Attachments end-to-end (view + upload + direct editing)
> Scope tag: [parity] | Effort: M (consolidation) | Targets: epic #251, PRs #301/#303/#309 | Tracking: #382

## Goal & UX
Land the full attachment chain as one coherent feature — web Calendar parity:
(a) **view/open** existing `ATTACH` props in `app/event/[uid].tsx` (icon + filename + mime·size list;
tap → base64 inline, re-fetch stripped embeds, or download → OS share sheet; external links → browser);
(b) **add/remove** attachments from the event detail and the event form — device file upload
(`expo-document-picker` → WebDAV PUT into `/Calendar`, web's default folder), or pick an existing
Nextcloud file (`DavFilePicker`), optional public `/s/<token>` share when the event has attendees,
optional remote-file deletion / share revocation on remove;
(c) **Direct Editing**: own-Files attachments open in `app/event/editor.tsx` (WebView) via one-time
OCS URLs; "new document" creators mint the file server-side and auto-attach it.
Everything already exists across three **stacked** branches — this plan is merge/consolidation, not re-implementation.

## Upstream dependencies & capability gating
- **`/f/<fileid>` links** (what web Calendar writes; 303 → HTML, unusable by CalDAV clients —
  server#59162): `fileLinks.ts` resolves via `SEARCH` basicsearch on `oc:fileid` against
  `remote.php/dav`, fallback `PROPFIND Depth: infinity` (rejected by some servers → "not found").
  `/s/<token>` → anonymous `…/s/<token>/download`. verify: resolver lives on the **upload** branch
  (#303), not viewer — #301 alone can't open `/f/` links (they're not http-openable; check
  `isOpenableAttachment` only accepts them via `isFileLinkUri`, added in #303). Merge order matters.
- **OCS `apps/files/api/v1/directEditing`** (`directEditing.ts`, editor branch): `GET` →
  `ocs.data.editors`/`creators` (keyed objects → `Object.values`); `POST /open` (`path`,`editorId`)
  → `data.url` one-time; `POST /create` (+`creatorId`,`templateId`). verify: empty editors =
  silent no-affordance gate (`fetchDirectEditing` catch → `[]`); no explicit version gate.
- **OCS `files_sharing/api/v1/shares`** shareType 3 read-only (`shares.ts`) — web's attendee mechanism.
- **Concurrency**: `fetchEventIcsWithEtag` + `updateEvent(…, etag)` → `If-Match` (weak `W/` etags
  dropped); `busy` ref in `useEventAttachments` serializes mutations; uploads use `If-None-Match: *`
  retry ×3 for name conflicts.
- WebView editor contract `DirectEditingMobileInterface` — pinned upstream refs
  (`upstream/nextcloud-android*@bac87f2`, `android-library@20bcd79`), refresh via
  `scripts/update-upstream-refs.sh`. Office UA spoof only for `{onlyoffice, eurooffice}`.

## Implementation (files to touch/create, ordered steps, per-PR merge order)
Branches are literally stacked (upload's log contains viewer's commits, editor's contains upload's).
**Merge #301 → #303 → #309**, rebasing each on `dev` after the previous lands. verify: GitHub PR
bases — if each targets `dev`, #303/#309 diffs include ancestor commits; retarget or merge strictly
in order (stacked history makes each rebase trivial).
1. **#301 `feat/attachment-viewer`** (base): `src/utils/caldav-parse.ts` `readAttachments`,
   `base64Fingerprint`, `stripInlineContent` (≤64 KB stays inline), `extractEventAttachments`,
   occurrence metadata via `fieldOverrides.attachments`, VTODO read; `attachments.ts`
   (`openAttachment`, 10 MB `MAX_ATTACHMENT_BYTES`, HEAD + `maxBodyBytes` + decoded-size triple
   check, same-origin auth scoping, 1 h FS cache, `expo-sharing`); `trustedFetch` `maxBodyBytes` /
   `ResponseTooLargeError` + native cap in `TlsTrustModule`; DB schema v8 (`attachments` JSON
   column, `serializeAttachments` sorted, `eventUnchanged`, `observedColumns`, mapper); types
   `EventAttachment`; list UI in `[uid].tsx`; deps `expo-file-system`/`expo-sharing`.
2. **#303 `feat/attachment-upload`**: new services `files.ts` (`uploadAttachmentFile`,
   `ownDavPath`, `listDavFolder`, `deleteRemoteFile`, `ATTACHMENTS_DIR='Calendar'`, `OC-FileId`
   header → `fileId`), `fileLinks.ts`, `shares.ts`; `attachmentWrite.ts` (raw-line unfold/fold-75,
   `buildAttachLine` incl. `X-NC-FILE-ID`, `injectAttachLine`/`removeAttachLine` — **master VEVENT
   only**); `useMutateEvent` `applyAttachmentDelta` on create + all 4 update paths,
   `cleanupUploaded` orphan sweep, `warnAttachmentFailures`, `resyncAfterAttachmentDelta`;
   `useEventAttachments` (`add`/`addRemote`/`remove` + `deleteFile`/`revokeShare` opts);
   `AttachmentsField` + `DavFilePicker` + `EventForm`/`new`/`edit` wiring; `pickDeviceAttachment`
   (stat-before-buffer), `askAttachmentShareMode`; `syncCalendarDelta` keep-unchanged-rows perf;
   dep `expo-document-picker`.
3. **#309 `feat/attachment-editor`**: `directEditing.ts`, `app/event/editor.tsx` (bridge polyfill,
   one-time URL via `editorSession` slot not route params, reload→fresh `open`, 15 s timeout,
   host-gated navigation, `downloadAs` same-host guard, share→fresh public link);
   `canEditAttachment`/`prepareAttachmentEdit`/`mimeFromName`; `[uid].tsx` editors/creators fetch
   + new-document sheet; `files.ts` `availableAttachmentPath`; `upstream/` + update script.
   `react-native-webview@15` already on dev (package.json:74) — no new dep.
4. Post-merge sweep: dedupe `attachments.ts` (grown on all 3), confirm one code path per action
   (detail `useEventAttachments` vs form `applyAttachmentDelta` — keep both, they share
   `attachmentWrite`/`files`/`shares`).

## Data model / types
- `EventAttachment {uri?, base64?, inline?, digest?, filename?, fmttype?, size?, fileId?}` —
  `inline`+`digest` mark server payloads stripped locally (occurrence rows, >64 KB embeds).
- `PendingAttachment {name, contentBase64, mimeType?, size?}`; `CreateEventInput` +
  `pendingAttachments`/`remoteAttachments`/`shareAttachments`/`removedAttachments`.
- **ATTACH is NOT writer-managed**: absent from `WRITER_MANAGED_PROPS`
  (dev `caldav-parse.ts:409-413`) → preserved verbatim via `extractExtraVeventLines`; edits layer
  explicit deltas on top (`removeAttachLine`/`injectAttachLine`). Exception VEVENTs exclude
  `attach|exdate` from extra lines (attachments are series-level). verify: no PR adds `'attach'`
  to `WRITER_MANAGED_PROPS` — that would double-write lines.
- WDB schema v8 `events.attachments` (sorted JSON) — all 3 branches add identical `toVersion:8`;
  verify no concurrently merged PR claims v8.

## Edge cases & error handling
- 10 MB cap everywhere; declared `SIZE` can lie → HEAD, streamed `maxBodyBytes`, decoded recount.
- Stripped/occurrence embeds re-fetch by filename+fmttype+size+`digest` fingerprint; ambiguous
  match → not-found alert. Inline ≤64 KB opens offline; URI/`/f/`/`/s/` all need network (no
  offline queue — uploads/deletes are online-only mutations; alert surfaces error).
- `/f/` to a deleted file → `resolveInternalFile` null → error (not browser); HTML response guard
  rejects login-page downloads; credentials only on exact origin match.
- Orphan uploads swept on PUT failure (`cleanupUploaded`); remove-no-match → resync, never delete.
- Write paths gated by `ready`: `!isTask && !isReadOnly && !isSubscribed` (VTODO attach is read
  but not writable). verify: server upload limits vs 10 MB client cap (`oc:bigfilechunking` /
  max_upload); public-share revoke only for own shares (`findShareByToken`).

## Tests (jest / tsc / caldav round-trip / emulator)
- Branches carry suites: `attachments.test.ts`, `attachmentWrite.test.ts`, `fileLinks/files/shares/
  directEditing/trustedFetch.test.ts`, `useEventAttachments`, `useMutateEvent.attachments`,
  `AttachmentsField`, `editorScreen`, `eventDetail`, `caldav-parse`, `syncCalendarDelta`.
- Round-trip: `buildIcsForInput` → `injectAttachLine` → `readAttachments` → `removeAttachLine`
  (folded lines, UTF-8 params, `/f/`+`/s/`+DAV+base64 shapes).
- `yarn tsc --noEmit`; emulator vs real NC: web-written `/f/` links, `/s/` shares, Text + Collabora
  + OnlyOffice editors (NC35: Euro-Office → `usesOfficeUserAgent` covers `eurooffice` — retest),
  recurring event add/remove, concurrent-edit 412, RO/subscribed calendar gating.

## Docs & i18n
- README + screenshots already on branches (`.github/assets/event-attachments.png`,
  `event-editor.png`); `upstream/README.md` documents the port contract.
- Locale keys `event.attachment*`/`event.editor*` ×9 files — verify all locales updated on merge.
- Update `nextcloud-feature-proposals.md` A9 → done; close issue #240 (attachments backfill →
  epic #251); report on tracking #382.

## Open questions / arbitration notes
- PR bases & merge order — confirm on GitHub; stacked history suggests sequential merge to `dev`.
- Keep two write paths (form delta vs detail `useEventAttachments`)? Both share services — keep,
  but factor share/delete prompts if they diverge.
- `X-NC-FILE-ID` param: verify it matches web's param exactly (drives web preview of DAV-URL
  attachments our writer emits instead of `/f/` links — check web still resolves them).
- Share prompt on every add when attendees present — acceptable vs remembered default? (web warns
  each time too; keep.)
- Offline attachment mutations: none (fail with alert) — deferred to D4 mutation-queue epic; note
  in #382.
