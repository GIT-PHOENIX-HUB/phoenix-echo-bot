# Channel Runbook — Microsoft Teams (employee-facing)

## Purpose + scope (ruling 2/60)
Reach the agents from inside the company's Teams — employee side of the hub.

## Current state — REAL adapter
`src/channels/teams.js` (~287 lines): Azure Bot Framework SDK; messaging endpoint `/api/messages`; activity handling + conversational flow.

## Config (names only)
- `channels.teams.enabled` (default false)
- `channels.teams.appId` / `appPassword` / `appTenantId` / `serviceUrl` ← env `PHOENIX_TEAMS_APP_ID` / `PHOENIX_TEAMS_APP_PASSWORD` / `PHOENIX_TEAMS_TENANT_ID`
- Azure side: a Bot Channels Registration pointing its messaging endpoint at this bot's public `/api/messages`.

## Enable
1. Bot registration exists in the tenant (ECHO-BOT app family); credential slots in env — never in repo.
2. Set `channels.teams.enabled: true`; restart.
3. Azure Bot registration's messaging endpoint → the bot's public HTTPS `/api/messages`.

## Verify
- @mention or DM the bot in Teams → reply arrives; bot log shows the activity.
- Wrong/missing tenant or appId → auth errors in log; fix registration, don't bypass.
## Disable / rollback
Set the channel's `enabled` flag to `false` in the active config (`config-vps.json` / `config-studio.json`) and restart the bot — a disabled channel logs one "disabled in config" line and touches nothing. Rollback is always config-only; no code changes.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
