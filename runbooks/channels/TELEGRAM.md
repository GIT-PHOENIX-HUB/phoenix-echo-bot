# Channel Runbook — Telegram (customer-facing)

## Purpose + scope (ruling 2/60)
Customer-facing lane: chat with customers, Mini App sign-in, estimates, scheduling, questions. This is the front door for `phoenix-electric-miniapp` (the Mini App launches from this bot and posts back through it).

## Current state — REAL adapter
`src/adapters/telegram-adapter.js` is instantiated by `src/index.js` and uses Telegram Bot API long polling.
It handles text/voice, registered slash commands that open `channels.telegram.miniAppUrl`, and
`web_app_data` fallback persistence. The orphaned `src/channels/telegram.js` is not the running adapter.

## Config (names only — values live in env/vault)
- `channels.telegram.enabled` (default false)
- `channels.telegram.botToken` ← env `PHOENIX_TELEGRAM_BOT_TOKEN`
- `channels.telegram.pollIntervalMs` (default 300)
- `channels.telegram.miniAppUrl` ← env `PHOENIX_TELEGRAM_MINIAPP_URL` — Web App buttons for the registered commands
- `runtime.baseUrl` — the Phoenix runtime the intake forward targets (`http://127.0.0.1:9120`)

## Enable
1. Bot token present in env (BotFather-issued; slot only — never commit).
2. Set `channels.telegram.enabled: true` in the active config; set `PHOENIX_TELEGRAM_MINIAPP_URL`.
3. Restart the bot; watch the log for Telegram polling start.

## Verify
- Send the bot a DM → agent replies on the Telegram channel.
- Launch the Mini App → submit a service request → bot log shows `MiniApp submission received` then the runtime forward. On a 502/network failure, a keyboard-button launch can deliver `tg.sendData`; the active adapter confirms receipt only after appending the normalized request to its durable fallback session.
- `curl -s localhost:18790/health` (bot up) and `curl -s localhost:9120/healthz` (runtime up).
## Disable / rollback
Set `channels.telegram.enabled` to `false` and restart to stop polling. Mini App HTTP routes have their own
`channels.miniApp.enabled` gate and must be disabled separately when that surface also needs rollback.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
