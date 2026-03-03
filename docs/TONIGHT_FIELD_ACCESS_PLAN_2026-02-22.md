# Tonight Field Access Plan (Mac Studio + VPS)

Date: 2026-02-22  
Scope: make Phoenix Echo reachable and useful while in the field, with Telegram primary, Teams required, iMessage assist lane.

## Decision

1. Primary field channel: Telegram
2. Required business channel: Teams
3. Secondary troubleshooting lane: WhatsApp (do not block tonight)
4. iMessage lane: monitor + draft response support first, full send automation later

## Definition of Done (Tonight)

1. Mac Studio gateway is running with token auth and bind control.
2. Telegram bot receives inbound messages and returns gateway responses.
3. Teams `/api/messages` is active and healthy.
4. Remote access path from field to Studio/VPS is verified.
5. Runbook + command sheet is saved and repeatable.

## Phase 1: Base Runtime (Mac Studio)

1. Pull latest:
```bash
cd ~/Phoenix-Echo-Gateway
git pull origin main
npm install
```

2. Configure `~/.phoenix-echo/config.json`:
```json
{
  "gateway": {
    "port": 18790,
    "bind": "127.0.0.1",
    "auth": {
      "mode": "token",
      "token": "env:PHOENIX_GATEWAY_TOKEN"
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "env:PHOENIX_TELEGRAM_BOT_TOKEN",
      "pollIntervalMs": 300
    },
    "teams": {
      "enabled": true,
      "appId": "env:PHOENIX_TEAMS_APP_ID",
      "appPassword": "env:PHOENIX_TEAMS_APP_PASSWORD",
      "appTenantId": "env:PHOENIX_TEAMS_APP_TENANT_ID",
      "serviceUrl": "env:PHOENIX_TEAMS_SERVICE_URL"
    },
    "whatsapp": {
      "enabled": false
    }
  }
}
```

3. Export required secrets (shell, launchd, or vault-injected env):
```bash
export PHOENIX_GATEWAY_TOKEN='...'
export PHOENIX_TELEGRAM_BOT_TOKEN='...'
export PHOENIX_TEAMS_APP_ID='...'
export PHOENIX_TEAMS_APP_PASSWORD='...'
export PHOENIX_TEAMS_APP_TENANT_ID='...'
export PHOENIX_TEAMS_SERVICE_URL='https://smba.trafficmanager.net/amer/'
```

4. Start and verify:
```bash
cd ~/Phoenix-Echo-Gateway
PHOENIX_AUTH_PROFILE_PATH="$HOME/.phoenix-echo/auth-profiles.json" npm start
curl -sS http://127.0.0.1:18790/health
curl -sS -H "x-phoenix-token: $PHOENIX_GATEWAY_TOKEN" http://127.0.0.1:18790/api/channels/status
```

## Phase 2: Field Reachability

1. Keep gateway bind at `127.0.0.1` for safety.
2. Reach it from field through one secure path:
   - SSH tunnel from phone/laptop
   - Tailscale/ZeroTier private network
   - reverse proxy with strict auth/TLS
3. Validate:
```bash
curl -i https://<your-entrypoint>/health
curl -i -H "x-phoenix-token: <token>" https://<your-entrypoint>/api/sessions
```

## Phase 3: iMessage Assist Lane (Tonight Scope)

Goal: improve driving workflow without risky direct send automation.

1. Monitor incoming iMessage events on Mac.
2. Generate draft replies through gateway.
3. Notify user with draft suggestion and source context.
4. Keep final send manual for now.

This keeps safety high while still delivering assistive value in field operations.

## Smoke Matrix

1. `GET /health` -> 200
2. `GET /api/channels/status` -> Telegram ready, Teams configured
3. Telegram inbound -> gateway response
4. Teams message inbound -> gateway response
5. Unauthorized API call -> 401
6. Authorized API call -> 200

## If One Channel Fails

1. Keep gateway live.
2. Keep Telegram as operational primary.
3. Keep Teams as required lane and troubleshoot in parallel.
4. Do not block field usage waiting for WhatsApp/iMessage full automation.

