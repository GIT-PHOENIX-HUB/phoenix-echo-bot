# Channel Runbook — Command App integration (employee-facing)

## Purpose + scope (ruling 2/60)
Employee lane: the Phoenix/Electrical Guru for every employee — contractor-work help, clock-in, daily logs (now with voice dictation), SharePoint drawings reference, questions.

## Current state — app talks RUNTIME direct; bot layer is SCAFFOLD
- The Command App (`phoenix-command-app` @ `feat/runtime-wire-9120`+) calls the Phoenix runtime DIRECTLY: `/v1/timeclock` + `/v1/dailylog` (MSAL bearer) and `/v3/chat` (tokenless browser bridge). It does NOT ride this bot today.
- `src/channels/command-app.js` (~46 lines) is a stub (auth validation / WS push are `TODO`). If/when the employee surface should converge onto the hub (one brain for all channels), that is a DESIGN CALL for OS/Shane — registered in the gap-map; do not build it silently.

## Config (names only)
- `channels.commandApp.enabled` (default false — leave false; nothing behind it)
- `runtime.baseUrl` — where the real employee traffic goes today

## Verify (today)
- Employee flows verify against the runtime, not the bot: `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:9120/v1/timeclock -H 'Content-Type: application/json' -d '{}'` → 401 (MSAL gate up).
- `src/index.js` has no Command App import or registration. Changing `channels.commandApp.enabled` produces
  no bot initialization log and no runtime effect.
## Disable / rollback
No bot-side Command App surface is registered. Employee traffic rolls back at the separately owned Command
App/runtime deployment, not through this inert flag.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
