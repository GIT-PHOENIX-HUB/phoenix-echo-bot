# Channel Runbook — Mini App integration (customer-facing)

## Purpose + scope (ruling 2/60)
The integration layer between the Telegram Mini App (`phoenix-electric-miniapp`) and the hub: customer estimates, scheduling requests, questions, app sign-in.

## Current state — LIVE routes + thin adapter
- `src/miniapp-routes.js` (REAL, wired in `src/index.js`): `POST /api/miniapp/submit` → FORWARDS to runtime `/v1/intake/*` (type map: service-request / size / generator-lead / maintenance; `X-Telegram-Init-Data` passed through; 502/503 on failure so the app's fallback fires) · `POST /api/miniapp/chat` → routes through the bot agent (`handleMessage`) · `products` / `nec` / `quotes` / `job-status` are honest empty stubs.
- `src/channels/mini-app.js` (~40 lines) is a scaffold wrapper — the routes above are the real surface.

## Config (names only)
- `runtime.baseUrl` / `runtime.wsUrl` / `runtime.token` (empty slot) — the Phoenix runtime this hub fronts
- env `PHOENIX_TELEGRAM_MINIAPP_URL`

## Verify
- `curl -s -X POST localhost:18790/api/miniapp/submit -H 'Content-Type: application/json' -d '{"type":"service-request"}'` → 502 "Backend rejected submission" WITHOUT a valid `X-Telegram-Init-Data` (the runtime enforces the HMAC — a 502 here proves the forward + the auth gate both work).
- With the real Mini App (valid initData): 2xx and the runtime's intake response inside `data.runtime`.

## Known next build (gap-map)
Customer chat UI in the Mini App itself — the bot's `/api/miniapp/chat` endpoint already exists and works; the app has no screen for it yet.
## Disable / rollback
Set the channel's `enabled` flag to `false` in the active config (`config-vps.json` / `config-studio.json`) and restart the bot — a disabled channel logs one "disabled in config" line and touches nothing. Rollback is always config-only; no code changes.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
