# C10 — Attach photos from Nextcloud

> Scope tag: [ecosystem] | Effort: M | Targets: epic #251, extends PR #303 | Tracking: #382

## Goal & UX

Add photo sources to the attachment action sheet (`AttachmentsField.pick()`, branch
`feat/attachment-upload` = PR #303): today it offers "From this device" (`pickDeviceAttachment`,
DocumentPicker) and "From Nextcloud files" (`DavFilePicker`). C10 adds **"Take a photo"**
(camera → uploaded *copy* into `/Calendar/` via existing `uploadAttachmentFile`) and
**"From Nextcloud photos"** — an image-only DAV browser with thumbnails and a shortcut to
Photos albums. Selected server files are attached **by reference, no copy**: `addRemote` /
`applyAttachmentDelta` (`useMutateEvent.ts` on branch, ~line 62) inject `ATTACH:<davUrl>`.

**verify — ATTACH convention**: the branch writes the *absolute DAV URL* plus
`;X-NC-FILE-ID=<id>` param (`buildAttachLine`, `attachmentWrite.ts`), **not** `ATTACH:/f/<fileid>`.
`/f/<id>` is what the *web* writes (comment in `fileLinks.ts:6-9`); the app detects/resolves it
for reading but deliberately writes DAV URLs. C10 keeps that convention.

## Upstream dependencies & capability gating

- **Base**: branch off `feat/attachment-upload` (it already ships `listDavFolder` PROPFIND
  depth:1 on `remote.php/dav/files/<davUserId>` with `oc:fileid`, `DavEntry`, `fileDavUrl`,
  `DavFilePicker`, `addRemote`, `remoteAttachments` in `CreateEventInput`). Rebase if #303 merges.
- **Albums**: `PROPFIND {base}/remote.php/dav/photos/<uid>/albums` Depth:1 (list), then per-album
  Depth:1 (members). Members are named `<fileid>.<ext>`; display name via
  `{http://nextcloud.org/ns}file-name` (upstream photos PR #1146). **verify**: no stable
  `apps/photos/api/v1/` albums REST API exists — DAV is the client API; confirm on NC34/35.
- **Thumbnails**: `GET {base}/index.php/core/preview?fileId=<id>&x=128&y=128&a=true` + Basic auth
  ("normal preview api by fileid", per upstream). Non-200/HTML body → icon fallback.
- **Gating**: probe `dav/photos/<uid>/albums` once per picker open; 404 (Photos app disabled /
  NC too old) → hide the albums section, keep the plain image-filtered files browser. No
  capabilities change required; `fetchServerCaps` (`nextcloud.ts:79-99`) untouched.
- **New dep**: `expo-image-picker` is **not** in package.json (`expo-camera` exists but only
  backs the QR login scanner via `modules/zxing-scanner`). `launchCameraAsync` avoids a custom UI.

## Implementation (files to touch/create, ordered steps)

1. `package.json` + `app.config.ts` — add `expo-image-picker` (~57.x to match SDK 57); add a
   second `expo-camera`-style permission entry or the image-picker plugin string for camera usage.
2. `src/services/nextcloud/files.ts` — add `photosUrl()` builder next to `filesUrl()`; new
   `listPhotoAlbums(account)` and `listAlbumEntries(account, albumPath)` reusing the
   `listDavFolder` regex parser (+ request `nc:file-name`); add `previewUrl(account, fileId)`;
   optional `mimePrefix?: string` filter on `listDavFolder`.
3. `src/features/event/utils/attachments.ts` — `pickCameraPhoto(): Promise<PendingAttachment|null>`
   mirroring `pickDeviceAttachment` (~line 373): `launchCameraAsync({quality:0.8})` → stat →
   `MAX_ATTACHMENT_BYTES` guard → base64 read → `PendingAttachment`.
4. `src/features/event/components/PhotoPicker.tsx` **(new)** — variant of `DavFilePicker`
   (`imageOnly` filter `isDir || mime.startsWith('image/')`), thumbnail grid/list rows via a small
   `AttachmentThumb` component (`Image` fed by `previewUrl` fetched through `trustedFetch` →
   `res.base64()` data-URI or cache file, like `downloadAndShare`), plus an "Albums" section when
   the probe succeeds.
5. `src/features/event/components/AttachmentsField.tsx` — extend `pick()` Alert with
   `event.attachTakePhoto` → `pickCameraPhoto` → `onAdd`, and `event.attachFromPhotos` →
   `PhotoPicker` → `onAddRemote` (same `fileDavUrl` + `fileId` payload as today).
6. Album-member resolution: album URIs live under `dav/photos/…`, outside `ownDavPath` — resolve
   `entry.fileId` through `resolveInternalFile` (`fileLinks.ts`) to the real files path before
   `onAddRemote`, so public-share/delete-own-file logic keeps working.
7. No change needed in `useEventAttachments.addRemote` / `useMutateEvent.applyAttachmentDelta` —
   own-DAV URIs already get the `askAttachmentShareMode` prompt when the event has attendees.

## Data model / types

Reuse `DavEntry` (path/name/isDir/mime/size/fileId), `EventAttachment`, `PendingAttachment`
(`types/index.ts:45-65` on branch). New: `type PhotoAlbum = { name: string; path: string;
fileCount?: number; coverFileId?: number }`. No WatermelonDB schema/migration changes — attachments
stay in the ICS blob. `CreateEventInput` unchanged (`pendingAttachments`/`remoteAttachments`).

## Edge cases & error handling

- Photos app disabled / NC < 25 (photos DAV) → probe 404 → hide albums entry, plain picker still works.
- Upstream bug photos#3513: a trashed album member makes the whole album-list PROPFIND 404 →
  catch, surface `event.photosLoadError`, fall back to files browsing.
- Preview failures (missing provider, HEIC/SVG, offline) → per-row icon fallback, never block list.
- Camera permission denied → `event.cameraPermissionDenied` alert (pattern: `QrLoginScanner`).
- Camera shot > `MAX_ATTACHMENT_BYTES` (10 MB) → existing too-large alert; iOS HEIC shots upload
  as `image/heic` (web preview may not render — accepted, note in docs).
- Large photo folders → `FlatList` windowing already; lazy thumbnails only for visible rows.
- Shared/other-users' files can't be public-shared (`ownDavPath` null) — existing share fallback
  keeps the private URI; attendees won't open it (same limitation as today).
- Files picker must keep showing folders even when `imageOnly` (navigate into subfolders).

## Tests (jest / tsc / emulator)

- Extend `__tests__/services/files.test.ts`: `listPhotoAlbums`/`listAlbumEntries` multistatus
  parsing (`nc:file-name`, `<fileid>.ext` members), `previewUrl` format, `mimePrefix` filter.
- New `__tests__/features/event/PhotoPicker.test.tsx`: image filtering keeps dirs, album section
  hidden on 404, thumbnail fetch failure → icon.
- Extend `__tests__/features/event/AttachmentsField.test.tsx`: new action-sheet entries wired to
  `onAdd`/`onAddRemote`; camera denied path.
- `pickCameraPhoto` unit test with mocked `expo-image-picker` + `expo-file-system`.
- `tsc --noEmit`; jest suite. Emulator/manual on real NC: Photos enabled+disabled, album attach →
  verify `X-NC-FILE-ID` + DAV URI in ICS, attendee event → public-share prompt, camera capture.

## Docs & i18n

- 9 locale files (`src/locales/{en,de,es,fr,it,nl,oc,pt,ru}.json`): `attachTakePhoto`,
  `attachFromPhotos`, `photosLoadError`, `albumsEmpty`, `cameraPermissionDenied`.
- `README.md` + `USER_GUIDE.md` attachments section (branch already updates it — extend, don't
  fork); optional upstream pin in `upstream/` for the photos DAV shape (precedent:
  `feat/attachment-editor` pins nextcloud-android refs).

## Open questions / arbitration notes

- **Scope**: minimal C10 = image-filtered `DavFilePicker` + thumbnails + camera. Albums section is
  the extra mile — propose keeping it but flag if review wants it split (S → M delta).
- **verify**: include `video/*` in the photos filter? Spec says photos; gallery intent suggests yes.
- **verify** on NC34/35: `photos` DAV root shape (`albums` vs `sharedalbums`) and `nc:file-name`
  namespace (`nextcloud.org` vs `nextcloud.com`).
- Keep writing DAV URLs (not `/f/<id>`) — consistent with #303; the web previews via
  `X-NC-FILE-ID`. Revisit only if web-parity testing shows broken attachment chips.
- iOS `launchCameraAsync` returns HEIC by default; converting to JPEG needs `expo-image-manipulator`
  — propose skipping conversion (upload as-is) unless arbitration asks.
