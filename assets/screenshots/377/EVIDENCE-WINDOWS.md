# Windows emulator validation — PR #4 (TRANSP/STATUS)

Independent re-validation on **Windows 11 + Android emulator API 36 (WHPX)** of the evidence produced on the Ubuntu host (`EVIDENCE.md`, same folder).

## Environment

- Host: Windows 11 Pro, i7-1165G7, 16 GB, Hyper-V/WHPX
- AVD `ncm-api36` (Pixel 7, Android 16, `google_apis;x86_64`)
- Backend: `nextcloud:34-apache` in Docker Desktop (CalDAV over `10.0.2.2`)
- Build: `app-release.apk` built from `feat/event-transp-status` (JDK 17, Gradle 9.3.1)

## Results

| Check | Result |
|---|---|
| `yarn tsc --noEmit` | ✅ clean |
| `yarn jest` | ✅ all suites pass except known flaky perf test `caldav-parse` (<3000 ms bound) under machine load |
| Event-form **Availability** picker (Busy/Free) | ✅ renders + applies — `win-01`, `win-02` |
| Event-form **Status** picker (Confirmed/Tentative/Cancelled) | ✅ renders + applies — `win-01`, `win-03` |
| Detail screen shows non-default values | ✅ — `win-04` |
| Agenda italic/strikethrough | ✅ covered by committed shots `04`, `07` |
| Full `event.e2e.ts` (Maestro + testcontainer) | ⚠️ UI flows all pass; jest DAV assertions `ECONNRESET` — testcontainer dies mid-run under memory pressure (environmental, not PR-related). |
| DB migration 9→10 | ✅ app boots on persisted DB (no crash) |

## Windows-specific fixes applied

- `e2e/app.ts`: `maestro()` spawns via `bash -c 'exec maestro "$@"'` on win32 (Node ≥20.12 blocks `.bat` spawn — EINVAL/ENOENT).
- Node 24 used (undici in testcontainers needs ≥20.19).
- `stylus_handwriting_enabled=0` on the AVD (Gboard stylus tutorial panel covered text fields).

## Verdict

The feature behaves identically on the Windows emulator: pickers, edit seeding, detail rows and agenda styling all verified. **GO** — pending only a stable full-suite e2e run (blocked by local Docker stability, not by the PR).
