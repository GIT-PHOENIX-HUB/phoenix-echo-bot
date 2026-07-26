# Runbook — Rotate the Phoenix gateway token (`PHOENIX_GATEWAY_TOKEN`)

**Ordered by Shane 2026-07-26** ("rotate") after three documentation setup blocks were found carrying
example values shaped like a real token. Doc content is already corrected; this is the credential half.

## What this token protects
The bot's internal gateway surface on `:18790` — `WS /ws` and `/api/*` except two independently
authenticated POST endpoints:

- `/api/messages` is authenticated by the Microsoft Bot Framework adapter.
- `/api/miniapp/submit` is authenticated by Telegram init-data HMAC at the Python runtime; its configured
  CORS preflight is also exempt.

The gateway token is compared with `timingSafeEqual` (`src/index.js`), so rotation is a value swap, not a
code change.

## GOOD NEWS — nothing in this repo has to change
Verified before writing this: every committed config (`config-vps.json`, `config-studio.json`,
`config.example.json`) stores the token as the **reference** `env:PHOENIX_GATEWAY_TOKEN`, never a literal
(`resolveEnvRef`, `src/config.js`). **No live token value has ever been committed here.** Rotation is
therefore: new value → vault + host env → restart → verify. Zero code, zero config edits.

## Two env names are accepted, with strict precedence
`resolveGatewayToken()` (`src/config.js:145-147`) reads:
```
process.env.PHOENIX_GATEWAY_TOKEN || process.env.PHOENIX_AUTH_TOKEN
```
`PHOENIX_AUTH_TOKEN` is a legacy fallback. When `PHOENIX_GATEWAY_TOKEN` is present, the legacy value is not
read and cannot keep the old credential active. Clear the legacy variable anyway: it would become active if
the primary variable were later removed.

## Precedence, so you know which value actually wins
env (`PHOENIX_GATEWAY_TOKEN`, else `PHOENIX_AUTH_TOKEN`) **overrides** anything the config resolves to. The
host environment is the source of truth at runtime.

## Steps

| # | Step | Whose hand |
|---|---|---|
| 1 | Generate a new value — `openssl rand -hex 32`. Never paste it into a doc, a config file, a commit, a chat message, or this runbook. | Shane (or an authorized operator) |
| 2 | Store it in Azure Key Vault under the existing gateway-token secret name. | Shane |
| 3 | On **every host running this bot** — the VPS and the Mac Studio (see `config-vps.json` / `config-studio.json`) — set `PHOENIX_GATEWAY_TOKEN` to the new value **and unset/replace any `PHOENIX_AUTH_TOKEN`**. | Shane |
| 4 | Restart the bot on each host. | Shane / operator |
| 5 | Verify (below) on each host. The verifier must be an authorized operator with host-injected access to `$OLD` and `$NEW`; never relay either value to a review seat. | Shane / authorized operator |
| 6 | Update any operator scripts, monitors, or saved curl commands that carry the old token. | whoever owns them |

## Verify — old rejected, new accepted
```bash
# OLD value must now FAIL
curl -s -o /dev/null -w '%{http_code}\n' -H "x-phoenix-token: $OLD" http://127.0.0.1:18790/api/miniapp/products
# expect 401

# NEW value must SUCCEED
curl -s -o /dev/null -w '%{http_code}\n' -H "x-phoenix-token: $NEW" http://127.0.0.1:18790/api/miniapp/products
# expect 200
```
Both checks must pass **on every host** before the rotation is called done. A 200 on the old value means the
effective primary value was not replaced (or the verifier tested the wrong host/value). A legacy value matters
only on a host where `PHOENIX_GATEWAY_TOKEN` is absent.

## Who does NOT hold this token (checked, so you don't chase ghosts)
- **Mini App submit client** — exact POST `/api/miniapp/submit` authenticates by Telegram `initData` HMAC,
  not this token. Other `/api/miniapp/*` routes remain gateway-internal unless separately redesigned.
- **Command App** — talks to the Python runtime directly (MSAL bearer / tokenless `/v3/chat`), not to this bot.
So no client app needs a rebuild or redeploy for this rotation.

## Rollback
Re-set the previous value on the affected host(s) and restart. Rotation is reversible until the old value is
deleted from the vault — delete it only after every host verifies green on the new one.

## Escalation
A host that will not accept the new token: post the bot's startup log lines to the oversight channel
(FORMATION/COMMS) — **never the value itself**, and never a partial value.
