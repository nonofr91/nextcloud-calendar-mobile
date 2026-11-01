# B3 — Push OAEP migration & notification links (NC35)
> Scope tag: [upstream, bug] | Effort: M | Targets: epic #255, PR #230 | Tracking: #382

## Goal & UX
Keep push notifications decryptable on NC35 while staying compatible with every
earlier server, and make notification `link`s reliably openable. No visible UX
change: same tray notifications, same NotificationCenter — they just keep working
when the server encrypts with RSA-OAEP instead of PKCS#1 v1.5, and tapping a
notification/entry opens the object page. Blocking item for #230 (impact analysis
R1, action A5/A8).

## Upstream dependencies & capability gating
- `notifications#2971` (NC34, **backported stable32 + stable33**): `lib/Push.php`
  reads app config `push_encryption_padding` — default `PKCS1`, admin opt-in `OAEP`
  via `occ config:app:set notifications push_encryption_padding --value=OAEP`.
- `notifications#3068` (NC35): same line, default flipped to `OAEP` (opt-out back
  to `PKCS1`). Applied in both `encryptAndSign` and `encryptAndSignDelete` →
  delete/delete-all push payloads use the same padding.
- PHP `OPENSSL_PKCS1_OAEP_PADDING` = RSA-OAEP with **SHA-1** for both the OAEP and
  MGF1 digests (PHP openssl cannot select another OAEP hash). Client MUST NOT use
  SHA-256 — this is the classic interop trap (verify in first device test).
- **No capability gating possible**: padding is an app config, not advertised in
  `ocs/v2.php/cloud/capabilities`; version detection is unreliable (OAEP exists on
  NC32–34, can be disabled on NC35). Official clients do try-decrypt → fallback
  (files-clients#124, talk-android#6139, ios#4103). We match that; drop any
  `status.php` version-sniffing idea except as optional attempt-ordering hint.
- `server#59608`: NC35 emits absolute notification `link`s; pre-35 can still send
  relative → client normalizes defensively for all versions.
- Device registration caps + VAPID recovery are server-side fixes → document only,
  no client work.

## Implementation (files to touch/create, ordered steps)
1. `package.json` (+ `yarn.lock`): add `node-forge` (+ `@types/node-forge` dev).
   Pure JS, zero native code, runs under Hermes and jest-expo. Alternatives
   evaluated: `react-native-quick-crypto` (WebCrypto `subtle.decrypt`, but needs a
   native dep + PKCS#8 conversion of the JSEncrypt PKCS#1 PEM — heavier);
   WebCrypto is absent in RN (`expo-crypto` = digests only). verify: forge RSA-2048
   decrypt perf on a real device (~one 256-byte block per push, expected OK) and
   forge loading under Hermes (widely used, still smoke-test).
2. `src/services/push/pushCrypto.ts`: add `decryptPushSubjectOaep(b64, pem)` —
   base64 → bytes, `forge.pki.privateKeyFromPem(pem).decrypt(bytes, 'RSA-OAEP',
   {md: forge.md.sha1.create(), mgf1: {md: forge.md.sha1.create()}})`, utf8 out.
   Rewrite `decryptPushSubject` to try OAEP, then fall back to the existing
   JSEncrypt PKCS#1 path; acceptance check = result JSON-parses (see Edge cases).
   Delete/rename `decryptPushSubjectLegacy` — its comment already wrongly claims
   OAEP (it is plain PKCS#1). Keep JSEncrypt `generatePushKeyPair` (padding-
   agnostic PEM; server picks padding) and `sha512` unchanged.
3. `src/services/push/pushMessageHandler.ts`: keep `JSON.parse(decrypted)` as the
   validity gate inside the decrypt loop (or a `tryDecryptions` helper returning
   `{payload, padding}` for logging). On total failure: keep current warn +
   OCS-refresh fallback — decrypt is only needed for the inline subject.
4. New `src/services/push/links.ts` (or inside `notifications.ts`):
   `resolveNotificationLink(link, baseUrl)` — `http(s)://` passthrough; leading
   `/` → `baseUrl + link`; bare `apps/…`/`index.php/…` → `baseUrl + '/' + link`;
   empty → return ''.
5. `src/services/nextcloud/notifications.ts`: `fetchNotifications` already has
   `account` → pass `baseUrl` into `parseNotification`/`parseAction` so `link` and
   `actions[].link` are normalized at the boundary; the store then always holds
   absolute URLs (single point, covers tray + center + future action buttons).
6. `src/services/push/pushMessageHandler.ts` (or `usePushNotifications.ts`): add
   `Notifications.addNotificationResponseReceivedListener` (already mocked in
   `__tests__/services/pushRegistration.test.ts`) → on tap, `Linking.openURL`
   of `data.link` inside try/catch; else fall back to routing `data.nid`.
7. `src/features/notifications/NotificationCenter.tsx` `onPress` (~line 82-89):
   keep `subjectRichParameters.event.id` → `router.push('/event/:uid')` primary;
   else if `item.link` → `Linking.openURL` (matches web "open object" semantics).

## Data model / types
- No DB/schema change. `OcsNotification.link` / `OcsNotificationAction.link` stay
  `string` (now guaranteed absolute post-parse). `PushMessageData`, `PushKeyPair`
  (PEM strings) unchanged. Optional internal `type PushPadding = 'oaep' | 'pkcs1'`
  for logging/tests only.

## Edge cases & error handling
- OAEP on NC32–34 (backport + occ opt-in) or PKCS1 forced on NC35 → try-fallback
  covers both; never gate on version alone.
- PKCS1-unpad of an OAEP ciphertext could spuriously "succeed" (~impossible, needs
  `0x00 0x02` + 8 nonzero bytes + `0x00`) yielding garbage → the JSON.parse gate
  is the real acceptance test, not decrypt success.
- Malformed/missing `subject`, bad base64, undecryptable, non-JSON → warn once and
  still refresh OCS notifications (existing catch path).
- `delete`/`delete-all` payloads share the padding (same server code path).
- Link forms to normalize: `/apps/calendar/…`, `apps/…`, `index.php/apps/…`,
  protocol-relative `//host/…` (prefix `https:`), empty string → no-op.
- `Linking.openURL` rejection (no browser, offline) → catch + silent/no toast
  (POC scope); verify whether a fallback toast is wanted.
- Multiple notifications in flight: each decrypt is one-shot, ~O(100ms) pure JS —
  acceptable; verify no jank on burst.

## Tests (jest / tsc / emulator)
- `__tests__/services/pushCrypto.test.ts`: forge-encrypted OAEP-SHA1 round-trip ✓;
  JSEncrypt PKCS1 round-trip via fallback ✓; wrong key → throws; garbage base64 →
  throws; delete payload round-trip; assert attempt order logs.
- `__tests__/services/notifications.test.ts`: relative `link`/`actions[].link` →
  absolute; absolute untouched; empty stays ''.
- `tsc --noEmit` + `yarn jest __tests__/services`.
- Manual matrix (dev-client): NC34 default (PKCS1) ✓; NC34 + occ `push_encryption_
  padding=OAEP` (backport path) ✓; NC35 default (OAEP) ✓; tap tray notification →
  link opens; center item with relative link → opens.
- verify: `scripts/test-notify-push.ts` — it does not encrypt subjects today, so
  no update needed; re-check if payload helpers get added.

## Docs & i18n
- Update on the POC branch: `V2-NOTIFICATIONS-CODE-OVERVIEW.md`,
  `PLAN-v2-notifications.md` — document OAEP/pkcs1 fallback rationale, SHA-1
  detail, absolute-link normalization, NC35 compat note, and that device caps +
  VAPID recovery are server-side (no client work).
- i18n: no new strings expected (open is silent). Only if a link-failure toast is
  added: new key in the 9 `src/locales/*.json` files.

## Open questions / arbitration notes
- Attempt order: recommend always OAEP-first (simplest; version unreliable).
  Alternative — order by `ocs.data.version` hint: micro-opt only, skip.
- node-forge vs `react-native-quick-crypto`: recommend forge now (zero native
  deps); revisit only if decrypt perf or a future WebCrypto need justifies Nitro.
- Keep JSEncrypt solely for keygen vs migrating fully to forge (`generateKeyPair`
  also exists there, slower in JS): recommend keep — keygen is proven; optional.
- Render `actions[]` (Accept/Decline GET/POST links) in NotificationCenter:
  deferred — list as follow-up in #230, not part of this bug-fix.
