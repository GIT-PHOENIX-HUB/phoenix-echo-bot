# Channel Runbook — Outlook / Email

## Purpose + scope (ruling 2/60)
Email in/out of the hub (company mailboxes).

## Current state — SCAFFOLD (honest)
`src/channels/outlook.js` (~43 lines) is a stub: enable-gate + logs only; Graph client, mail subscription, parse/route/reply are `TODO`. env slots exist for an IMAP/SMTP path (`PHOENIX_EMAIL_*`) but nothing consumes them yet.
**Do not enable expecting behavior — there is none.** The working email estate today is the PowerShell Mail Courier fleet (separate system, own runbooks); any build here must reconcile with it (registered cross-lane question) and follow draft-first/never-auto-send.

## Config slots (names only, currently unread by code)
- `channels.outlook.enabled` (default false)
- env `PHOENIX_EMAIL_ENABLED` / `PHOENIX_EMAIL_IMAP_HOST` / `PHOENIX_EMAIL_IMAP_PORT` / `PHOENIX_EMAIL_SMTP_HOST` / `PHOENIX_EMAIL_SMTP_PORT` / `PHOENIX_EMAIL_ADDRESS` / `PHOENIX_EMAIL_PASSWORD`

## Build path (when ordered)
Graph-first (tenant's own app registrations, cert auth — the Mail Courier pattern), not IMAP password auth; subscription webhook for inbound; replies draft-first through the approval surface.

## Verify (today)
The gateway does not read `channels.outlook.enabled`, import `OutlookChannel`, or emit an Outlook
initialization line. Changing the flag has no runtime effect today.
## Disable / rollback
This channel is a scaffold and has no live adapter to disable. Use
[the shared active-config procedure](README.md#find-the-active-config) for live channels.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
