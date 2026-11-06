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
- Language: replies follow the language of each message (no language slot in
  the NC35 contextagent:interaction inputShape — server-side behaviour).

## Emulator-specific workarounds used (local-only, not committed)

- `patches/expo-speech-recognition+57.1.1.patch`: Android `AudioSource.VOICE_RECOGNITION` → `MIC` — the API 36 ranchu audio HAL stalls the VOICE_RECOGNITION stream after ~5 s (known emulator regression).
- `stt.ts` `continuous: true` — pipes the recorder audio into `EXTRA_AUDIO_SOURCE`, bypassing the broken stream.
