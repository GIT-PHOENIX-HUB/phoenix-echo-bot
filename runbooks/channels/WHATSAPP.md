# Channel Runbook — WhatsApp (customer-facing)

## Purpose + scope (ruling 2/60)
Customer conversations on WhatsApp through the same hub brain.

## Current state — REAL adapter
`src/index.js` starts and registers `src/channels/whatsapp.js` asynchronously when
`channels.whatsapp.enabled` is true. The `whatsapp-web.js` bridge provides QR-code authentication,
send/receive, and a session persisted on disk. Authentication does not hold the HTTP gateway or other
channels offline.

## Config (names only)
- `channels.whatsapp.enabled` (default false)
- `channels.whatsapp.sessionDir` (default `~/.phoenix-echo/whatsapp-session`)
- `channels.whatsapp.allowedGroupIds` (default empty; exact WhatsApp group IDs)
- env `PHOENIX_WHATSAPP_ENABLED`
- env `PHOENIX_WHATSAPP_ALLOWED_GROUP_IDS` (comma-separated exact group IDs)

## Enable
1. Set `channels.whatsapp.enabled: true`; restart with a terminal attached.
2. Scan the QR code with the company WhatsApp phone (one-time; session persists to `sessionDir`).
3. Log shows client ready.

## Verify
- Text the company number → agent replies.
- Group messages are rejected by default. Add a test group's exact `@g.us` ID to
  `allowedGroupIds`, restart, and verify only that group can receive an agent reply.
- Media with no text/caption is ignored instead of being sent to the model.
- Restart the bot → session survives (no re-scan). If QR is demanded again, the session dir was lost — re-scan, then check disk/permissions.

## Honest limits
WhatsApp-Web bridge = unofficial surface: a WhatsApp update can break it; the phone must stay online. Treat as best-effort until/unless the business moves to the official WhatsApp Business API.
## Disable / rollback
Follow [the shared active-config procedure](README.md#find-the-active-config), set
`channels.whatsapp.enabled` to `false`, restart, and confirm `whatsapp` is absent from
`/api/channels/status`.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
