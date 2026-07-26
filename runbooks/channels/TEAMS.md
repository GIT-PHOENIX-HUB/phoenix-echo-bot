# Channel Runbook — Microsoft Teams (employee-facing)

## Purpose + scope (ruling 2/60)
Reach the agents from inside the company's Teams — employee side of the hub.

## Current state — REAL adapter
`src/adapters/teams-adapter.js` is instantiated by `src/index.js`; it uses the Azure Bot Framework SDK at
`/api/messages`. The orphaned `src/channels/teams.js` is not the running adapter.

## Config (names only)
- `channels.teams.enabled` (default false)
- `channels.teams.appId` / `appPassword` / `serviceUrl` ← env `PHOENIX_TEAMS_APP_ID` / `PHOENIX_TEAMS_APP_PASSWORD` / `PHOENIX_TEAMS_SERVICE_URL`
- `channels.teams.appTenantId` ← env `PHOENIX_TEAMS_APP_TENANT_ID`; this value is loaded but the current
  `BotFrameworkAdapter` constructor does not consume it, so it is not an enforced tenant boundary.
- Azure side: a Bot Channels Registration pointing its messaging endpoint at this bot's public `/api/messages`.

## Enable
1. Bot registration exists in the tenant (ECHO-BOT app family); credential slots in env — never in repo.
2. Set `channels.teams.enabled: true`; restart.
3. Azure Bot registration's messaging endpoint → the bot's public HTTPS `/api/messages`.

## Verify
- @mention or DM the bot in Teams → reply arrives; bot log shows the activity.
- Wrong/missing app ID or password → auth errors in log; fix registration, do not bypass.
## Disable / rollback
Set `channels.teams.enabled` to `false` and restart. The adapter and `/api/messages` route are then not registered.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
