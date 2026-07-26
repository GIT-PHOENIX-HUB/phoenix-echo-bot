# Channel Runbook — WhatsApp (customer-facing)

## Purpose + scope (ruling 2/60)
Customer conversations on WhatsApp through the same hub brain.

## Current state — UNWIRED SCAFFOLD
`src/channels/whatsapp.js` contains a `whatsapp-web.js` implementation, but `src/index.js` never imports,
constructs, starts, or registers it. No current configuration can produce a QR code or receive a message.

## Config (names only)
- `channels.whatsapp.enabled` (default false)
- `channels.whatsapp.sessionDir` (default `~/.phoenix-echo/whatsapp-session`)

## Enable
There is no supported enable procedure. Startup wiring, lifecycle ownership, and a focused integration test
must land before this channel can be called enableable.

## Verify
- `src/index.js` contains no WhatsApp import/registration.
- `GET /api/channels/status` contains no `whatsapp` adapter entry.

## Honest limits
WhatsApp-Web bridge = unofficial surface: a WhatsApp update can break it; the phone must stay online. Treat as best-effort until/unless the business moves to the official WhatsApp Business API.
## Disable / rollback
No live WhatsApp surface is registered today. Keep `channels.whatsapp.enabled: false`; changing it currently
has no startup effect.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
