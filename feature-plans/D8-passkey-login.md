# D8 — Passkey / improved login
> Scope tag: [mobile+] | Effort: M | Targets: issues #337, #47 | Tracking: #383

## Goal & UX
Harden the existing credential flow rather than rebuild it:
- **Today**: manual entry or QR scan in `app/(auth)/setup.tsx`; QR parses `nc://login` / `nc://onetime-login` via `parseNcLoginUrl` (`src/features/account/utils/ncLoginUrl.ts`); one-time tokens → app password via `exchangeOneTimeToken` (`src/services/nextcloud/nextcloud.ts:9-30`, `POST /ocs/v2.php/core/getapppassword-onetime`); validated by `validateCredentials` PROPFIND chain (`src/services/nextcloud/caldav.ts:80-114`). **No webview/browser login exists** (verified: WebView only in `src/features/map/components/MapView.tsx:5`).
- **(a) Passkey reality**: no upstream passkey→API auth exists — app passwords remain the only DAV/OCS credential (Nextcloud webauthn = web login only; even the official iOS app merely allows passkeys *inside* its auth browser, iOS#2300). Deliverable = **document the limit**, optionally make the browser login flow below passkey-capable.
- **(b) Browser login flow v2** (new UX): "Log in with browser" → `WebBrowser.openAuthSessionAsync` to the server's login page → works through SSO/OIDC and webauthn/passkey because auth happens in the system browser → app still receives an app password via polling.
- **(c) #337 fix**: user scanned QR on an SSO-provisioned instance and got `common.errorPermission` ("calendar read-only") — a PROPFIND in the login chain returned 403 and `describeMutationError` (`src/services/shared/errors.ts:41-48`) shows a misleading message. Add step-aware login diagnostics.
- **(d) Re-auth**: today 'lost' status surfaces only inside Settings → account (`app/(tabs)/settings/account/[id].tsx:160-162`); add proactive surface.
- **(e) #47 Android SSO**: Deck-style account import from the Nextcloud Files app — Android-only, native module, candidate split-out (arbitration).

## Upstream dependencies & capability gating
- Login flow v2 (`POST {base}/index.php/login/v2` → `{login, poll:{token,endpoint}}`) exists on all supported servers — **no capability gating needed**; verify on NC32/34/35 (e2e image `nextcloud:34-apache`, `e2e/nextcloud.ts:21`).
- Poll endpoint returns `{server, loginName, appPassword}` after the user completes web auth — including SSO/passkey flows — so **no `nc` scheme registration is strictly required**; verify `openAuthSessionAsync` (dep `expo-web-browser` present at package.json:55, plugin at app.config.ts:90, currently zero usages) semantics: it may block until redirect; run polling concurrently.
- Embedded `react-native-webview` does **not** get platform passkeys on iOS — if a webview variant is ever used, passkey is unavailable (documented upstream limitation).
- Android SSO (`com.github.nextcloud:Android-SingleSignOn` via jitpack) requires Nextcloud Files app installed; verify `SingleSignOnAccount.token` is usable as an app password for our own `trustedFetch` stack, else proxying through Files app would be required (architecture change).
- iOS has no SSO equivalent; self-signed-cert instances can't complete browser login (system TLS ≠ our `certTrust` pins) → manual/QR path must stay.

## Implementation (files to touch/create, ordered steps)
1. **#337 diagnostics**: in `app/(auth)/setup.tsx:50-108` tag each login step (`exchange`/`validate`/`profile`/`firstSync`); on failure show step + status, keep `describeMutationError` for the message; `console.warn` the `HttpError` context string (already carries e.g. `validateCredentials HTTP 403`, currently swallowed). New key `setup.errors.accessDenied` for 403-during-login (vs generic `errorPermission`).
2. **New `src/services/nextcloud/loginFlow.ts`**: `startLoginFlow(baseUrl)` → POST `/index.php/login/v2` via `trustedFetch`; `pollLoginFlow(poll, {timeoutMs~20min, intervalMs~1-2s})` → `{loginName, appPassword}`; map 404→expired, cancel via AbortSignal.
3. **`app/(auth)/setup.tsx`**: "Log in with browser" button → `cleartextConsent`+`certTrust` pre-check on `baseUrl` (`fetchServerCaps` probe), then `openAuthSessionAsync(login)` + parallel `pollLoginFlow`; on success feed existing `connectWith` (`:50`). Handle session 'cancel'/'dismiss' → abort poll.
4. **Reuse in `src/features/account/components/AccountReconnectForm.tsx`**: same browser button for re-auth (covers SSO re-auth where QR is awkward).
5. **Proactive auth-lost surface**: store `authStatus` per account (extend `src/stores/accountStore.ts` or a small hook) set from sync-path 401/403 (search sync error handling; `caldav.ts:144` only resets tokens); banner on `app/(tabs)/calendar` linking to `settings/account/[id]`.
6. **Secure storage audit**: already `expo-secure-store` `AFTER_FIRST_UNLOCK` (`src/services/nextcloud/auth.ts:13-15`) — keep (widgets/background sync need credentials); do NOT add `requireAuthentication` (would break headless widget/widget tasks); document rationale. Verify appPassword never logged (`setup.tsx:99` logs raw error object — check it can't contain the password; HttpError carries status+context only, OK).
7. **#47 Android SSO (spike → own sub-feature if accepted)**: `modules/nextcloud-sso` Expo module (precedent `modules/zxing-scanner`) wrapping `ImportSsoAccount` ActivityResultContract → `{server, user, token}` → `connectWith`; detect Files app absence → hide button.
8. Optional: register `nc` scheme so `nc://login` deep links route to `parseNcLoginUrl` (nice-to-have; verify need given polling path).

## Data model / types
- `Account` (`src/types/index.ts:1-10`) unchanged — app password remains the credential. Optional additive field `authMethod?: 'manual'|'qr'|'flow'|'sso'` for diagnostics/support (persisted inside existing SecureStore JSON, no migration needed if optional).
- `LoginFlowStart = {login: string; poll: {token: string; endpoint: string}}`; `LoginFlowResult = {server: string; loginName: string; appPassword: string}`.
- `NcLoginData` (`ncLoginUrl.ts:1-6`) unchanged.

## Edge cases & error handling
- SSO/OIDC instances: QR still works (one-time token minted server-side) but `loginname` ≠ `davUserId` — `validateCredentials` already resolves via `current-user-principal` (caldav.ts:94); keep fallback path; #337 likely died on a 403 here — step-aware error tells which PROPFIND failed.
- Browser flow on self-signed/HTTP dev instances → system browser fails where `trustedFetch`+pins would pass → keep manual path; hint text.
- Poll timeout/cancel, `openAuthSessionAsync` returns 'cancel' while poll pending, double-submit guards (`scannedRef` pattern, `QrLoginScanner.tsx:31`).
- `nc://onetime-login` codes are single-use/short-lived → existing `qrOneTimeExpired` (401/403 mapping, setup.tsx:152-157) stays correct.
- Android SSO: Files app not installed, multiple NC accounts, user denies the SSO consent dialog, Files app reinstalled (permission revoked upstream) → all fall back to manual/QR.
- 401 mid-sync on revoked app password → set 'lost' (not just in settings) + banner.

## Tests (jest / tsc / emulator — device auth flows)
- jest: `loginFlow.ts` poll state machine (mock `trustedFetch`: success, 404-expired, timeout, abort); extend `__tests__/api/nextcloud.test.ts` (`exchangeOneTimeToken` cases at :70-109); `parseNcLoginUrl` covered (`__tests__/features/ncLoginUrl.test.ts`); setup step-error rendering in `__tests__/app/setup.test.tsx`; banner visibility on mocked 401.
- `tsc --noEmit`.
- e2e: extend `e2e/` (testcontainers NC34 image exists): scripted login-flow v2 against `/index.php/login/v2`; re-run on `nextcloud:35-apache` when released; #337 regression needs an SSO/LDAP-provisioned instance — verify a mock-IdP container is feasible, else manual checklist.
- Emulator/device matrix: browser flow on plain NC, OIDC IdP, webauthn-enabled account (real passkey login through system browser); Android SSO with/without Files app; QR camera-denied path already covered (`qrCameraDenied`, QrLoginScanner.tsx:74-99).

## Docs & i18n
- USER_GUIDE/README: "Logging in" section — QR vs browser vs app password; explicit note **passkeys can be used inside the browser login, but the app still stores an app password** (no passkey API auth exists upstream); SSO instance guidance; #47 fallback wording.
- New keys: `setup.loginWithBrowser`, `setup.browserLoginHint`, `setup.errors.accessDenied`, `setup.errors.flowExpired`, `settings.account.authLostBanner`, `setup.loginWithNextcloudApp` (Android) — all 9 `src/locales/*.json`.
- Document that `nc` scheme remains unregistered unless step 8 lands (`scheme: 'nextcloud-calendar'`, app.config.ts:24).

## Open questions / arbitration notes
- **[mobile+] arbitration**: hardening + browser flow are arguably reliability/parity (#337 is a bug); Android SSO (#47) is true [mobile+] and likely effort L alone — recommend splitting into its own Discussion; tracking epic #383.
- Passkey/WebAuthn: verify on a real NC34/35 + webauthn instance that `openAuthSessionAsync` (ASWebAuthenticationSession / Custom Tab) actually permits passkey UI — Safari/Chrome support yes; embedded WebView no.
- #337 root cause unproven without an SSO-provisioned repro instance — diagnostics-first approach lands the instrumentation, then iterate on reporter feedback.
- `openAuthSessionAsync` may require a `redirectUrl` — confirm polling-only works without registering `nc:`; else register scheme + handler.
- SSO `SingleSignOnAccount.token` semantics (is it a raw app password usable in Basic auth?) — must be verified in the spike before committing to #47.
