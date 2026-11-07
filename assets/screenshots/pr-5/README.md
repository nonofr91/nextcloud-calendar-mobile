# PR5 — Voice assistant evidence captures

End-to-end validation on Android emulator (ncm-api36) against production
Nextcloud `https://cloud.sipc-cgt.fr` (TaskProcessing context agent enabled).
PC microphone routed to the emulator via Windows Stereo Mix + QEMU host mic.

| File | Shows |
|---|---|
| `01-stt-transcription-what-time.png` | Real mic STT: "What time is it" transcribed (Soda offline en-US_v3072) → local answer "Il est actuellement 11 heures 45 minutes à Paris" |
| `02-agent-query-fr-thinking.png` | Typed FR query "fais-moi un resume de ma semaine" → "The server is thinking…" (TaskProcessing task scheduled) |
| `03-agent-response-fr-week-summary.png` | Agent read calendar + Deck + Talk on prod and replied in French with the real week events |
| `04-mutation-confirm-gate.png` | Mutation gate: "Send this request to the Nextcloud agent? It can modify your calendar." for "decale ma reunion" (freeform + mutation-like verb) |
| `05-agent-response-fr-clarify.png` | Agent reply listing the real Nov 5 meetings and asking for new time/duration/attendees (multi-turn via conversation_token) |
| `06-agent-timeout-still-thinking.png` | Client-side poll deadline (POLL_TIMEOUT_MS) reached → "The server is still thinking, try again later" while the agent task was still running |
| `07-voice-sheet-listening.png` | Voice sheet in listening state (mic capture active) |
| `08-soda-pack-download.png` | On-device speech recognition settings downloading the Soda language pack (required for offline STT on this AVD) |
| `09-agent-create-confirmation-fr.png` | Agent CREATE executed on prod: "Le rendez-vous 'Test agent' a bien été ajouté dans ton calendrier Personnel pour demain, le 7 novembre 2026 de 10h à 11h" |
| `10-agent-created-event-visible.png` | The "Test agent" event visible on the calendar grid (Sat Nov 7, 9 AM) — proof the agent write tool ran server-side |
| `11-local-delete-confirm-card.png` | Local delete path: "supprime Test agent" → confirm card 'Delete "Test agent"?' |
| `12-local-delete-done.png` | "Event deleted." — local CalDAV delete executed on prod, event gone from the grid |
| `13-local-targeting-no-event-found.png` | Local targeting edge case: "supprime le rendez-vous Test agent de demain" → "No event found" (extracted title needle "rendez-vous Test agent" doesn't substring-match summary "Test agent") |
| `14-agent-move-wrong-day.png` | Agent move attempt: it searched "aujourd'hui" for a meeting 12h–14h while the meetings were on Nov 5 — ambiguous phrasing, nothing moved |
| `15-move-gate.png` | Mutation gate for "peux-tu ajouter un rendez-vous test" (freeform + mutation verb → agent) |
| `16-agent-created-rdv-test.png` | Agent created "Rendez-vous test" on Sat Nov 7 ~13h — then asked to move it |
| `17-move-not-applied.png` | After "mets-le a 16h30": the event still shows at 1 PM — agent move not applied (it had previously cancelled the Nov-5 meetings instead of moving them) |
| `18-cancelled-events-cleared-after-resync.png` | Thu Nov 5 empty after the STATUS:CANCELLED parser fix + forced full resync — the agent-cancelled meetings no longer render |
| `19-create-attendee-busy-warning.png` | Create with a busy attendee: "Create 'Plannifie une reunion' on Monday 9 November · 10:45 in Personnel? — with Test Attendee — warning, busy at that time: Test Attendee" — free/busy checked via the CalDAV scheduling outbox after the calendar disambiguation pick |
| `20-create-attendee-busy-alt-slots.png` | Busy attendee → the card now offers free alternative slots the same day ("pick a free slot:" 12:00–13:00 / 14:30–15:30 / 17:00–18:00), merging attendee VFREEBUSY with the user's own blocking-calendar events; when the requested day is full the search extends up to 5 days ahead |
| `21-alt-slot-confirm-card.png` | After picking the 12:00 candidate the confirmation card re-arms at the new time: "Create 'Plannifie une reunion' on Monday 9 November · 12:00 in Personnel? — with Test Attendee" |
| `22-invitations-drawer-badge.png` | Logged in as TestAttendee (second account): drawer shows "Invitations" with badge 5 — pending REQUESTs delivered to his schedule-inbox |
| `23-invitations-list-actions.png` | Invitations screen (attendee side): pending cards with organizer, date and the three actions Decline / Maybe / Accept — incl. "Invite A - a accepter", "Invite B - provisoire" |
| `24-invite-a-accept-pending.png` | Tapping "Accept" on Invite A: all three buttons switch to loading state while `respondToInvitation` PUTs the PARTSTAT reply |
| `25-invite-b-maybe-done.png` | After "Maybe" on Invite B: the card is gone from the inbox — server returned PARTSTAT=TENTATIVE on the organizer copy |
| `26-invitations-after-responses.png` | Inbox after the three responses: only the two pre-existing pending invites remain (A accepted, B tentative, C declined+removed) |
| `27-attendee-calendar-accepted.png` | TestUser's month view afterwards: "Invite" appears Nov 16 (accepted) and "Invite B" Nov 17 (tentative); declined Invite C on Nov 18 is not shown |

**Incident evidence**: the Nov-5 "Reunion" events were set to `STATUS:CANCELLED`
by the agent during earlier move attempts (visible as "Cet événement a été
annulé" in the Nextcloud web UI) — agent mutations are real and can be
destructive on ambiguous phrasing. The app kept displaying cancelled events
because `STATUS:CANCELLED` isn't filtered in `normalizeEvents` and agent
mutations don't invalidate the local event store.

## Results

- READ via agent (calendar/Deck/Talk context): ✅
- CREATE via agent (server-side tool): ✅ event landed on prod
- DELETE via local intent path (CalDAV): ✅ confirm card → deleted on prod
- MOVE via agent: not exercised to completion — ambiguous test phrase led the
  agent to query the wrong day; local move path also answered "No event found"
  because "midi" parsed as noon today, not Nov 5.
- Multi-turn conversation: ✅ conversation_token carried across turns.
- Attendee availability on create: ✅ after the disambiguation-path fix, the
  confirmation card warns when a resolved attendee is busy (VFREEBUSY via the
  scheduling outbox) and offers free alternative slots (same day first, then up
  to 5 days ahead, merged with the user's own blocking calendars). Picking a
  candidate re-arms the card at the new time; falling back to warn-and-confirm
  when nothing is free.
- Language: replies follow the language of each message (no language slot in
  the NC35 contextagent:interaction inputShape — server-side behaviour).
- Invitations end-to-end (attendee side, second account TestAttendee): ✅ REQUEST
  lands in the drawer badge + invitations list; Accept → event materialized on
  his calendar, organizer copy updated PARTSTAT=ACCEPTED; Maybe → materialized,
  PARTSTAT=TENTATIVE; Decline → removed, PARTSTAT=DECLINED. Required the active-
  account fix on the invitations screen (was reading the first account's inbox).

## Emulator-specific workarounds used (local-only, not committed)

- `patches/expo-speech-recognition+57.1.1.patch`: Android `AudioSource.VOICE_RECOGNITION` → `MIC` — the API 36 ranchu audio HAL stalls the VOICE_RECOGNITION stream after ~5 s (known emulator regression).
- `stt.ts` `continuous: true` — pipes the recorder audio into `EXTRA_AUDIO_SOURCE`, bypassing the broken stream.
