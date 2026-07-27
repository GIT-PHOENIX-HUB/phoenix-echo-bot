# Channel Runbook — Telegram (customer-facing)

## Purpose + scope (ruling 2/60)
Customer-facing lane: chat with customers, Mini App sign-in, estimates, scheduling, questions. This is the front door for `phoenix-electric-miniapp` (the Mini App launches from this bot and posts back through it).

## Current state — REAL adapter
`src/index.js` constructs the live `src/adapters/telegram-adapter.js`: Telegram Bot API long
polling with text and voice-message handling. Mini App submissions arrive separately over
`/api/miniapp/submit` and are forwarded to the Phoenix runtime `/v1/intake/*` (type-mapped,
`X-Telegram-Init-Data` passed through for the runtime's HMAC check) — see
`src/miniapp-routes.js`.

## Config (names only — values live in env/vault)
- `channels.telegram.enabled` (default false)
- `channels.telegram.botToken` ← env `PHOENIX_TELEGRAM_BOT_TOKEN`
- `channels.telegram.pollIntervalMs` (default 300)
- `runtime.baseUrl` — the Phoenix runtime the intake forward targets (`http://127.0.0.1:9120`)
- Mini App launch URL: configure the bot's menu button / Web App URL in BotFather. The live
  adapter does not read a Mini App URL environment variable or create a launch button.

## Enable
1. Bot token present in env (BotFather-issued; slot only — never commit).
2. Set `channels.telegram.enabled: true` in the active config. If the Mini App should launch from
   this bot, configure its HTTPS Web App URL in BotFather.
3. Restart the bot; watch the log for Telegram polling start.

## Verify
- Send the bot a DM → agent replies on the Telegram channel.
- Launch the Mini App → submit a service request → bot log shows `MiniApp submission received` then the runtime forward; runtime answers 2xx (or the bot returns 502 and the Mini App falls back to `tg.sendData` — that fallback firing IS the honest failure mode, investigate the runtime).
- `curl -s localhost:18790/health` (bot up) and `curl -s localhost:9120/healthz` (runtime up).
## Disable / rollback
Follow [the shared active-config procedure](README.md#find-the-active-config), set
`channels.telegram.enabled` to `false`, restart, and confirm `telegram` is absent from
`/api/channels/status`.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
