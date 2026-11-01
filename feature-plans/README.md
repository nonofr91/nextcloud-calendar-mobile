# Feature implementation plans — Nextcloud ecosystem opportunities

Technical implementation plans generated for every candidate in the feature backlog ([Discussion #383](https://github.com/SoluceTechnologies/nextcloud-calendar-mobile/discussions/383)), produced from the Nextcloud 34/35 impact analysis ([Discussion #382](https://github.com/SoluceTechnologies/nextcloud-calendar-mobile/discussions/382)).

Each plan is **analysis only** — feature work stays frozen pending maintainer arbitration. Every plan verifies cited files against the `dev` branch (or the named feature branch), lists upstream dependencies/capability gating, implementation steps, tests, docs/i18n needs, and open questions.

**Scope tags:** `[parity]` exists in web Calendar · `[upstream]` new server API · `[ecosystem]` builds on another Nextcloud app · `[mobile+]` beyond web scope — **arbitration required**.

## A — Web parity gaps

| ID | Feature | Effort | Plan |
|----|---------|--------|------|
| A1 | Per-calendar default reminders | M | [plan](A1-default-reminders.md) |
| A2 | Delete without notifying attendees | S | [plan](A2-delete-without-notify.md) |
| A3 | Reply to invitations (PARTSTAT) | M | [plan](A3-partstat-reply.md) |
| A4 | Event trash bin (recently deleted) | M | [plan](A4-trash-bin.md) |
| A5 | Duplicate event | S | [plan](A5-duplicate-event.md) |
| A6 | External calendar subscriptions (.ics) | M | [plan](A6-external-subscriptions.md) |
| A7 | ICS import via OCS endpoint | S | [plan](A7-ocs-ics-import.md) |
| A8 | Delegation & federated-share visibility | S | [plan](A8-delegation-federated.md) |
| A9 | Attachments end-to-end | M | [plan](A9-attachments-chain.md) |
| A10 | Contact birthdays | S | [plan](A10-contact-birthdays.md) |

## B — New upstream APIs

| ID | Feature | Effort | Plan |
|----|---------|--------|------|
| B1 | Room/resource browser by building | M | [plan](B1-room-browser.md) |
| B2 | Attendee availability (OOO + presence + restrictions) | M | [plan](B2-attendee-availability.md) |
| B3 | Push OAEP migration & notification links (NC35) | M | [plan](B3-push-oaep.md) |
| B4 | Server unified search | M | [plan](B4-server-unified-search.md) |
| B5 | Tentative invitation rendering (iMIP) | S | [plan](B5-tentative-rendering.md) |
| B6 | AI text features via TaskProcessing | L | [plan](B6-ai-summary.md) |
| B7 | Calendar export (OCS + client fallback) | S | [plan](B7-ocs-export.md) |

## C — Wider Nextcloud ecosystem

| ID | Feature | Effort | Plan |
|----|---------|--------|------|
| C1 | Deck cards in the agenda | M | [plan](C1-deck-in-agenda.md) |
| C2 | Complete VTODO task support | M-L | [plan](C2-full-tasks.md) |
| C3 | Extended Talk integration | M | [plan](C3-talk-extended.md) |
| C4 | Invite a circle/team | S-M | [plan](C4-invite-team-circle.md) |
| C5 | Linked notes/collectives | S | [plan](C5-linked-notes.md) |
| C6 | Date poll creation (Polls app) | L | [plan](C6-date-poll.md) |
| C7 | Public calendar sharing link | M | [plan](C7-public-share.md) |
| C8 | Directions to event location | S | [plan](C8-location-directions.md) |
| C9 | Registration link via Forms | S | [plan](C9-forms-registration.md) |
| C10 | Attach photos from Nextcloud | M | [plan](C10-attached-photos.md) |
| C11 | Richer contact integration | S | [plan](C11-richer-contacts.md) |

## D — Mobile-specific (arbitration required)

| ID | Feature | Effort | Plan |
|----|---------|--------|------|
| D1 | Geofenced reminders | M | [plan](D1-geofenced-reminders.md) |
| D2 | Tasks / countdown widgets | M | [plan](D2-tasks-countdown-widget.md) |
| D3 | System quick actions & deep links | M | [plan](D3-quick-actions-deeplinks.md) |
| D4 | Offline mode + mutation queue | L | [plan](D4-offline-queue.md) |
| D5 | Unified multi-account agenda | L | [plan](D5-multi-account.md) |
| D6 | Wearables (Wear OS / watchOS) | L | [plan](D6-wearables.md) |
| D7 | OCR poster/flyer → prefilled event | M | [plan](D7-ocr-event.md) |
| D8 | Passkey / improved login | M | [plan](D8-passkey-login.md) |
| D9 | Spoken day briefing (TTS) | S-M / M | [plan](D9-spoken-briefing.md) |
| D10 | Conversational voice assistant | M-L / L | [plan](D10-voice-assistant.md) |
| D11 | Spoken notifications (CarPlay / Android Auto) | S / S-M / M | [plan](D11-spoken-notifications.md) |

## Notable findings surfaced during planning

- **Already shipped**: A10 contact birthdays (PR #295), C8 directions action mostly exists, Deck VTODOs already sync (C1 is opt-in styling), `nextcloud-calendar://event/<uid>` deep links work (D3).
- **Near-complete on branches**: A3 ≈80% on `feature/caldav-invitations` (#226); A6 display path ≈90% on `dev`.
- **Corrections to the catalog**: Deck publishes cards as **VTODOs** not VEVENTs (C1); publish/unpublish is `POST <cs:publish-calendar/>` not PROPPATCH (C7); the search provider id is `calendar`, not `calendar-events` (B4); Polls API v1.0 lives under `/ocs/v2.php/` only (C6); Forms needs apiVersion negotiation v2.1↔v3 (C9); push padding is admin-configurable on NC32+ — try-OAEP→fallback, no version sniff (B3); PHP OAEP = SHA-1 (B3).
- **Risks confirmed**: `attendeeLines` rewrites `PARTSTAT=NEEDS-ACTION` (R2 — blocks A3/B5/C4); JSEncrypt is pkcs1-only (R1 — blocks #230); `parseVtodo` ignores RRULE (R3 — blocks C2); attachment branches are stacked → merge order #301→#303→#309 (A9).
