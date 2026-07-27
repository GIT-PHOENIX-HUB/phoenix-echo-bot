# Channel Runbook — Microsoft Teams (employee-facing)

## Purpose + scope (ruling 2/60)
Reach the agents from inside the company's Teams — employee side of the hub.

## Current state — REAL adapter
`src/index.js` constructs `src/adapters/teams-adapter.js`, the live Azure Bot Framework adapter,
and registers its messaging endpoint at `/api/messages`. `src/channels/teams.js` is not used by
the gateway.

## Config (names only)
- `channels.teams.enabled` (default false)
- `channels.teams.appId` / `appPassword` ← env `PHOENIX_TEAMS_APP_ID` / `PHOENIX_TEAMS_APP_PASSWORD`
- `channels.teams.appTenantId` / `serviceUrl` ← env `PHOENIX_TEAMS_APP_TENANT_ID` /
  `PHOENIX_TEAMS_SERVICE_URL`; these are config slots only and are not enforced by the live adapter.
- Azure side: a Bot Channels Registration pointing its messaging endpoint at this bot's public `/api/messages`.

## Enable
1. Bot registration exists in the tenant (ECHO-BOT app family); credential slots in env — never in repo.
2. Set `channels.teams.enabled: true`; restart.
3. Azure Bot registration's messaging endpoint → the bot's public HTTPS `/api/messages`.

## Verify
- @mention or DM the bot in Teams → reply arrives; bot log shows the activity.
- Wrong/missing app ID, password, or Azure Bot registration → auth or delivery errors in the log; fix
  the credential/registration, don't bypass.
- Changing `appTenantId` or `serviceUrl` does not currently alter `TeamsAdapter` authentication or routing.
## Disable / rollback
Follow [the shared active-config procedure](README.md#find-the-active-config), set
`channels.teams.enabled` to `false`, restart, and confirm `teams` is absent from
`/api/channels/status`.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
