# Nextcloud Calendar Mobile — Agent Rules

Project-specific rules for Devin when working on `SoluceTechnologies/nextcloud-calendar-mobile`.

## 1. Feature workflow: Discussions → Issues → PRs

We do **not** create issues directly for new feature ideas. The maintainer team is small and wants to validate scope before issues are opened.

### Process

1. **Discussion** — every new feature starts in a GitHub Discussion epic.
   - Existing epics: #250, #251, #252, #253, #254, #255, #256, #258
   - Workflow guide: #257
2. **Validation** — maintainers comment with priority/scope (P0/P1/P2 / out of scope).
3. **Issue** — once validated, a focused issue is created from the sub-task.
4. **Development** — work on a dedicated branch; keep changes scoped.
5. **PR** — open a PR that links to the issue and, when relevant, the epic discussion.
6. **Review & merge** — after maintainer review.
7. **Update epic** — check the box or add the issue number in the discussion.

### For Devin

- Before creating a new issue, ask the user whether it has been validated in a Discussion.
- Before starting implementation, verify the relevant Discussion has maintainer approval.
- If no Discussion exists for a feature, help the user draft one before creating an issue.

## 2. No feature without documentation

Every feature PR must include documentation updates.

### Required documentation checklist

```markdown
## Documentation
- [ ] In-app help section updated (if a new user-facing feature)
- [ ] USER_GUIDE.md or `docs/*.md` updated
- [ ] Screenshot updated (if the UI changed)
- [ ] i18n strings added to `src/locales/en.json`
- [ ] README updated if the public feature list changed
```

### Where docs live

- `README.md` — marketing overview, download links, screenshots
- `USER_GUIDE.md` — detailed end-user guide (create if it does not exist)
- `docs/` — split guides when `USER_GUIDE.md` grows too large
- `src/locales/en.json` — in-app strings, including help text
- `/.github/assets/` or `/docs/screenshots/` — UI screenshots

### For Devin

- When asked to implement a feature, include a documentation plan in the proposal.
- Before finalizing a PR, verify the documentation checkbox is addressed.

## 3. CalDAV and ICS conventions

The app speaks CalDAV to Nextcloud and stores events locally in WatermelonDB. Any change to event/calendar data must respect these conventions.

### Parsing

- Use `src/utils/caldav-parse.ts` to parse CalDAV multistatus responses.
- Use `src/utils/ics.ts` to parse and generate iCalendar data.
- Prefer standard iCalendar properties (RFC 5545, 7986).

### Generating ICS

- Include `PRODID`, `VERSION:2.0`, `CALSCALE:GREGORIAN` in the VCALENDAR.
- Use UTC (`Z`) or explicit `TZID` + `VTIMEZONE` blocks.
- For new event properties, add them to the `extraLines` generation path in `src/utils/ics.ts`.

### New event properties

Before adding a property, check:

- Is it defined in RFC 5545 or RFC 7986?
- Does Nextcloud Calendar web support it?
- Is it preserved by Nextcloud's CalDAV server on round-trip?

### For Devin

- When adding an event property, search for `ics.ts`, `caldav-parse.ts`, and `EventForm.tsx`.
- Write a failing test in `__tests__/utils/ics.test.ts` or `__tests__/services/caldav.test.ts` if it exists.

## 4. View and UI conventions

- `ViewMode` lives in `src/features/calendar/constants.ts`.
- `daysPerPage(mode)` and `pageDates()` live in `src/features/calendar/utils/grid.ts`.
- New views must use `InfinitePager` consistently with existing view components.
- `useWindowDimensions()` is the preferred way to react to screen size/orientation.
- The app currently locks phones to portrait in `app/_layout.tsx` (see `useOrientationLock`); any landscape work must first remove or make this conditional.

### For Devin

- Before changing view logic, read `grid.ts`, `MonthDayView.tsx`, `TimeGridView.tsx`, and `CalendarTopBar.tsx`.

## 5. Testing and verification

- Run type checks: `yarn tsc`
- Run unit tests: `yarn jest`
- For UI/gesture changes, prefer an Android emulator test before declaring the task done.
- Use `__tests__/helpers/theme.tsx` for rendering wrapped in the theme provider.

### For Devin

- After code changes, run the relevant verification commands.
- If tests fail, debug before asking the user.

## 6. Internationalization

- All user-facing strings must go through `i18next` and `src/locales/en.json`.
- Add the English string first; other languages can be translated later.
- Do not hardcode French or English strings in components.

### For Devin

- When adding UI text, check `src/locales/en.json` for existing keys.
- Reuse keys when the same wording appears in multiple places.

## 7. Git and PR conventions

- Branch names: `feat/<short-name>` or `fix/<short-name>`.
- Commits: concise, focused on *why*, not only *what*.
- PR description must include:
  - Link to the related issue
  - Link to the related Discussion epic (when applicable)
  - Documentation checklist (see section 2)
  - Test plan
- Do not force-push unless explicitly asked.

### For Devin

- Before `gh pr create`, run `git status`, `git diff`, and `git log` to match the repo style.
- Use `gh pr create --repo SoluceTechnologies/nextcloud-calendar-mobile` to target the correct remote.

## 8. Security and secrets

- Never commit secrets, tokens, or app passwords.
- `.env` files must be in `.gitignore`.
- Do not log network requests that may contain credentials.

### For Devin

- If a file containing a secret is found, alert the user and do not commit it.
- Use `expo-secure-store` for storing credentials on device.

## 9. Maintainer communication

The primary maintainers are `RambokDev` (Charles GTE) and `KillianLarcher`.

- For process and prioritization, use GitHub Discussions.
- For validated, actionable work, use GitHub Issues.
- For code changes, use Pull Requests.
- For private or urgent matters, use the existing email thread.

### For Devin

- Do not create issues without user confirmation that the maintainers have validated the feature in a Discussion.
- Do not open PRs without a clean `git status` and a focused diff.

## 10. Pre-PR orchestration

Before any `gh pr create`, the preparatory skills must be applied:

1. **`nextcloud-calendar-workflow`** — the feature must be validated in a Discussion epic, an issue must exist, and the branch must follow naming convention.
2. **`nextcloud-calendar-caldav`** — if the feature touches CalDAV/ICS, parsing, generation, types, and round-trip tests must be updated.
3. **`nextcloud-calendar-docs`** — if the feature is user-facing, in-app help, onboarding, tooltips, `USER_GUIDE.md`, screenshots, and i18n strings must be updated.
4. **`nextcloud-calendar-pr`** — final checklist: tests (`yarn tsc`, `yarn jest`), emulator test if UI/gesture, clean git history, and PR description with issue + discussion links.

### Pre-PR checklist

```markdown
## Pre-PR checks
- [ ] Feature validated in the correct GitHub Discussion epic
- [ ] Focused issue created and linked
- [ ] Branch name: `feat/<short-name>` or `fix/<short-name>`
- [ ] CalDAV / ICS conventions checked (if touching events, sync, or properties)
- [ ] Documentation checklist complete
- [ ] Tests run: `yarn tsc` and `yarn jest`
- [ ] Android emulator test done (if UI/gesture change)
- [ ] i18n strings added to `src/locales/en.json`
- [ ] Commit history is clean and focused
- [ ] PR description links to issue and discussion epic
```

### PR description template

```markdown
## Summary
- What changed (2-3 bullet points)
- Why (link to issue and discussion epic)

## Related
- Closes #<issue-number>
- Discussion epic: #<discussion-number>

## Pre-PR checklist
- [ ] Feature validated in discussion epic
- [ ] CalDAV / ICS conventions checked
- [ ] Documentation updated (in-app help, USER_GUIDE, screenshots, i18n)
- [ ] Tests pass: `yarn tsc`, `yarn jest`
- [ ] Emulator test done (if UI change)
- [ ] README updated if needed

## Test plan
- [ ] Test 1
- [ ] Test 2
```

### For Devin

- When the user says "create the PR", ask first:
  1. "Have the workflow, CalDAV, and docs skills been applied?"
  2. "Can you confirm the tests passed?"
  3. "Is the documentation checklist complete?"
- Do not proceed until all checks are confirmed or explicitly skipped by the user.
