# PR5 — Voice assistant test scenario (round 2)

Second live pass covering the paths not yet evidenced in this folder. Same
setup: Android emulator (API 36), release APK built from `pr-5`, account
ARASABruno on `https://cloud.sipc-cgt.fr`, PC mic routed to the emulator
(local-only STT patches required — see README §workarounds).

Conventions: typed input is used wherever the intent path is what matters;
the mic is only required for S8. Confirm cards are always validated BEFORE
tapping — never confirm a mutation on real data (see S4). Evidence files
continue the numbering started by README.md.

## S1 — Offline outbox: create queued honestly

The outbox is new code on this branch and has no live evidence yet.

1. Enable airplane mode on the emulator (`adb shell cmd connectivity airplane-mode enable` or quick settings).
2. Voice sheet → type: `crée rdv offline test demain à 10h`
3. Confirmation card → **Confirmer**.

Expected:
- Reply is the *queued* wording ("will be created when back online"), never "Event created." — `createEvent.mutateAsync` returned `'queued'`.
- Disable airplane mode → the pending op is pushed on the next sync; event lands on the grid AND on the prod web UI.

Evidence: `29-offline-create-queued.png`, `30-offline-event-after-reconnect.png`.

## S2 — Local create (typed → confirm → CalDAV PUT)

Round 1 only evidenced the *agent* create (09/10). The local path was never
run to completion.

1. Voice sheet → type: `crée rdv vocal test mardi à 11h`
2. Card shows: title `rdv vocal test` (capitalized summary), `mardi … · 11:00`, target calendar.
3. **Confirmer**.

Expected: "Event created." → event visible on the week grid AND on prod.
Variant: `crée rdv dentiste dans 2 heures` (relative time) and a day-only
`crée rdv jeudi` (midnight → re-armed at 09:00 by `effectiveStart`).

Evidence: `31-local-create-confirm.png`, `32-local-create-on-grid.png`.

## S3 — Local move

13 only proved the *miss* path ("No event found"); a real move was never applied.

1. Voice sheet → type: `décale rdv vocal test à 15h`
2. `findEventTargets` substring-matches the S2 event → card 'Move "rdv vocal test" to …· 15:00?'
3. **Confirmer** → event sits at 15:00 on grid + prod.

Variant (day-only): `décale rdv vocal test à vendredi` → card shows the day
only and the move keeps the event's clock time (`newStartHasTime === false`).

Evidence: `33-local-move-confirm.png`, `34-local-move-on-grid.png`.

## S4 — Multi-match disambiguation on real data (CAREFUL)

The prod calendar holds two real candidates: `Perma David` and `Perma Vincent`.

1. Voice sheet → type: `supprime la perma`
2. `findEventTargets` returns ≥2 matches → `disambiguating` lists both with
   `dd DD/MM HH:mm` suffixes — order = chronological.
3. Pick either candidate → card 'Delete "Perma David"?'
4. **Tap Annuler — these are real events.** The disambiguation and the card
   are what we prove here; do not confirm.

To fully exercise delete-disambiguation: first run S2 twice with slightly
different titles, then `supprime rdv vocal test` → the candidate list is
built on disposable data and the delete can be confirmed safely.

Evidence: `35-disambiguate-perma.png` (candidate list), optionally
`36-disambiguate-confirm.png` (card before cancelling).

## S5 — Read intents: agenda & next

No spoken briefing was captured in round 1.

1. `qu'est-ce que j'ai demain` → `replying` with the day briefing spoken via
   TTS segments; hidden calendars must be excluded.
2. `prochain rdv` → next upcoming event (within the 14-day window) plus
   same-day follow-ups.
3. Pick a day known to be empty → `nothingOnDay` wording.

Evidence: `37-agenda-briefing.png`, `38-next-event.png`.

## S6 — Slot search without attendees

20/21 evidenced the busy-attendee merge; the own-calendars-only path is untested live.

1. `trouve un créneau de 30 minutes demain` → candidate slots aligned on
   :00/:30 inside 09:00–18:00, busy = writable calendars only.
2. Verify a read-only calendar's events (holidays / shared rosters) do NOT
   block; then flag it blocking in settings → same query now avoids it.
3. Pick a slot → (calendar pick if no default) → confirm → created.

Evidence: `39-slot-candidates.png`, `40-slot-created.png`.

## S7 — Recurring event scope prompt

Setup: create a weekly series `Serie test` on prod (web UI).

1. `supprime serie test` → `decideMoveEventScope` returns 'prompt' → the
   3-choice list: this event / this and following / the whole series.
2. Pick "this event only" → confirm → only that occurrence is deleted; the
   rest of the series survives on prod.
3. Repeat on another occurrence with a move: `décale serie test à 14h` →
   same scope prompt → verify the picked scope is the one applied.

Evidence: `41-scope-prompt.png`, `42-scope-this-only.png`.

## S8 — STT fr-FR + network fallback (commit `3a5e627e`)

Requires the local mic patches. Logcat is the evidence, not screenshots:

```
adb logcat | grep -iE 'SpeechRecognition|language|AiAi'
```

1. Ensure the fr-FR pack is still absent (settings → speech languages).
2. Sheet → mic → speak `quelle heure est-il`.
3. Expected sequence: `start` with `requiresOnDeviceRecognition=true` →
   `language-not-supported` (code 13) → our wrapper restarts with `false`
   → network recognition returns the transcript → local time answer.
4. If the pack got installed meanwhile, on-device succeeds directly — then
   reset the pack (or use a fresh AVD snapshot) to exercise the fallback.

Evidence: logcat excerpt attached to the PR comment.

## S9 — Agent DELETE (OPTIONAL — destructive)

The agent already cancelled real meetings during round-1 move attempts.
Only run this against the disposable `rdv vocal test` event, with a phrasing
the local parser won't claim (no `supprime` keyword as leading verb), e.g.
`peux-tu faire le ménage dans mon agenda et enlever le rdv vocal test` →
mutation gate → confirm → agent-side delete. Skip entirely if the account
holds anything that cannot be lost.

Evidence: `43-agent-delete-gate.png`, `44-agent-delete-done.png`.

## S10 — Hostile lifecycle

1. `fais-moi un résumé de ma semaine` (agent) → close the sheet while
   `thinking` → the AbortController cancels the poll; no crash, no late reply.
2. Reach a confirm card (S2) → type a new utterance WITHOUT confirming →
   the pending op is dropped; tapping a stale confirm does nothing.
3. Let a spoken reply finish → sheet auto-closes ~4 s later; reopen → clean state.

Evidence: `45-close-during-thinking.png`, `46-new-utterance-drops-pending.png`.

## Order

S1 → S2 → S3 → S5 → S6 → S4 → S7 → S10 → S8 → S9.
Cleanup afterwards: delete every `rdv vocal test` / `rdv offline test` /
`Serie test` left on prod.
