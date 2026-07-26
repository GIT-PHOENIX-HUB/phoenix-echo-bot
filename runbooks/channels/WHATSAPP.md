# Channel Runbook — WhatsApp (customer-facing)

## Purpose + scope (ruling 2/60)
Customer conversations on WhatsApp through the same hub brain.

## Current state — REAL adapter
`src/channels/whatsapp.js` (~307 lines): `whatsapp-web.js` (WhatsApp Web bridge) — QR-code authentication, send/receive, session persisted on disk.

## Config (names only)
- `channels.whatsapp.enabled` (default false)
- `channels.whatsapp.sessionDir` (default `~/.phoenix-echo/whatsapp-session`)
- env `PHOENIX_WHATSAPP_ENABLED`

## Enable
1. Set `channels.whatsapp.enabled: true`; restart with a terminal attached.
2. Scan the QR code with the company WhatsApp phone (one-time; session persists to `sessionDir`).
3. Log shows client ready.

## Verify
- Text the company number → agent replies.
- Restart the bot → session survives (no re-scan). If QR is demanded again, the session dir was lost — re-scan, then check disk/permissions.

## Honest limits
WhatsApp-Web bridge = unofficial surface: a WhatsApp update can break it; the phone must stay online. Treat as best-effort until/unless the business moves to the official WhatsApp Business API.
## Disable / rollback
Set the channel's `enabled` flag to `false` in the active config (`config-vps.json` / `config-studio.json`) and restart the bot — a disabled channel logs one "disabled in config" line and touches nothing. Rollback is always config-only; no code changes.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
