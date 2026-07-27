# Channel Runbook — Mini App integration (customer-facing)

## Purpose + scope (ruling 2/60)
The integration layer between the Telegram Mini App (`phoenix-electric-miniapp`) and the hub: customer estimates, scheduling requests, questions, app sign-in.

## Current state — LIVE routes + thin adapter
- `src/miniapp-routes.js` (REAL, wired in `src/index.js`): `POST /api/miniapp/submit` → FORWARDS to runtime `/v1/intake/*` (type map: service-request / size / generator-lead / maintenance; `X-Telegram-Init-Data` passed through; 502/503 on failure so the app's fallback fires) · `POST /api/miniapp/chat` → routes through the bot agent (`handleMessage`) · `products` / `nec` / `quotes` / `job-status` are honest empty stubs.
- `src/channels/mini-app.js` (~40 lines) is a scaffold wrapper — the routes above are the real surface.

## Config (names only)
- `channels.miniApp.enabled` (default true; set false for rollback)
- `runtime.baseUrl` / `runtime.wsUrl` / `runtime.token` (empty slot) — the Phoenix runtime this hub fronts
- env `PHOENIX_MINIAPP_ENABLED`

## Verify
- With gateway authentication configured:
  `curl -s -X POST localhost:18790/api/miniapp/submit -H "X-Phoenix-Token: $PHOENIX_GATEWAY_TOKEN" -H 'Content-Type: application/json' -d '{"type":"service-request"}'`
  → 502 "Backend rejected submission" without valid `X-Telegram-Init-Data` (the response proves
  the request passed gateway authentication, reached the forwarding route, and was rejected by
  the runtime auth gate). Omit only the gateway-token header in an explicitly unauthenticated
  local configuration.
- With the real Mini App (valid initData): 2xx and the runtime's intake response inside `data.runtime`.

## Known next build (gap-map)
Customer chat UI in the Mini App itself — the bot's `/api/miniapp/chat` endpoint already exists and works; the app has no screen for it yet.
## Disable / rollback
Follow [the shared active-config procedure](README.md#find-the-active-config), set
`channels.miniApp.enabled` to `false`, restart, and confirm `/api/miniapp/health` returns 404
(include `X-Phoenix-Token` when gateway authentication is configured).

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
