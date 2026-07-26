# Channel Runbook — Mini App integration (customer-facing)

## Purpose + scope (ruling 2/60)
The integration layer between the Telegram Mini App (`phoenix-electric-miniapp`) and the hub: customer estimates, scheduling requests, questions, app sign-in.

## Current state — LIVE submission route + thin adapter
- `src/miniapp-routes.js` (REAL, gated by `channels.miniApp.enabled` in `src/index.js`):
  - `POST /api/miniapp/submit` translates the live client types `service_request`, `generator_lead`, and
    `maintenance_request` to the runtime `/v1/intake/*` models. Missing/unknown types return 400.
  - The gateway validates Telegram `initData` HMAC and one-hour freshness before granting the public submit
    exemption, then forwards it for runtime revalidation. It also forwards `X-Request-Id` and aborts after
    `runtime.timeoutMs` (502) instead of hanging.
  - Only a valid Telegram submission is exempt from the private gateway token. The browser never receives
    that token.
  - Cross-origin use requires one exact `channels.miniApp.allowedOrigin`; blank means same-origin proxy only.
  - Telegram `sendData` fallback is consumed by the active adapter and appended durably to
    `.phoenix-sessions/miniapp-fallback-<chat>.jsonl` for follow-up; it is not falsely reported as a runtime write.
- `POST /api/miniapp/chat` routes through the bot agent, while `products` / `nec` / `quotes` / `job-status`
  remain honest empty stubs. Those non-submit routes still use gateway-token auth.
- `src/channels/mini-app.js` (~40 lines) is a scaffold wrapper — the routes above are the real surface.

## Config (names only)
- `runtime.baseUrl` / env `PHOENIX_RUNTIME_URL` — runtime intake target
- `runtime.timeoutMs` / env `PHOENIX_RUNTIME_TIMEOUT_MS` — positive upstream timeout
- `channels.miniApp.enabled` / env `PHOENIX_MINIAPP_ENABLED` — opt-in; default false
- `channels.miniApp.allowedOrigin` / env `PHOENIX_MINIAPP_ALLOWED_ORIGIN`
- `channels.telegram.miniAppUrl` / env `PHOENIX_TELEGRAM_MINIAPP_URL`

## Verify
- Same-origin unauthenticated probe: `curl -s -X POST localhost:18790/api/miniapp/submit -H 'Content-Type: application/json' -d '{"type":"service_request"}'` → 401 without valid Telegram init data.
- Configured cross-origin probe: preflight from the exact allowed origin returns 204 and only that origin is echoed.
- With the real Mini App (fresh valid initData): gateway HMAC passes, the runtime revalidates, and a valid
  intake returns 2xx with the runtime response inside `data.runtime`.
- Stop the runtime: the request returns bounded 502; a Telegram keyboard-button launch can deliver `sendData`,
  which produces a bot confirmation and a durable fallback session entry.

## Known next build (gap-map)
Customer chat UI in the Mini App itself — the bot's `/api/miniapp/chat` endpoint already exists and works; the app has no screen for it yet.
## Disable / rollback
Set `channels.miniApp.enabled` or `PHOENIX_MINIAPP_ENABLED` to `false` and restart. The bot logs
`Mini App routes disabled by configuration`; the submit/chat/stub routes are not registered.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
