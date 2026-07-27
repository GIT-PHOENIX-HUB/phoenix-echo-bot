# Channel Runbooks — Phoenix Echo Bot (the channel hub)

Shane's ruling (2/60): the echo bot is the connection between all terminals — **each channel gets its own small runbook.** These are those. One page each: purpose/scope, HONEST current state (real vs scaffold, from the code not from hope), config key NAMES (values live in env/vault, never here), enable steps, verification, disable/rollback, escalation.

| Channel | State | Facing |
|---|---|---|
| [TELEGRAM](TELEGRAM.md) | REAL (polling + Mini App forward to runtime intake) | Customer |
| [TEAMS](TEAMS.md) | REAL (Bot Framework, /api/messages) | Employee |
| [WHATSAPP](WHATSAPP.md) | REAL (WhatsApp-Web bridge, QR session) | Customer |
| [OUTLOOK](OUTLOOK.md) | SCAFFOLD — do not enable expecting behavior | Company mail |
| [MINI-APP](MINI-APP.md) | LIVE routes (submit→runtime intake, chat→agent) + thin wrapper | Customer |
| [COMMAND-APP](COMMAND-APP.md) | App goes runtime-direct; bot layer scaffold (convergence = design call) | Employee |

Shared substrate: the bot serves on `:18790`; the Phoenix runtime it fronts is `phoenix.runtime.app:gateway` on `:9120` (`runtime{}` block in config). Secrets: slots only, vault-held, never committed.

## Find the active config
The startup log entry `Phoenix Echo Gateway starting` records the resolved `configPath`. That exact
file is authoritative for the running process: it is `PHOENIX_CONFIG_PATH` when the service sets
that variable, otherwise `~/.phoenix-echo/config.json`. The checked-in `config-vps.json` and
`config-studio.json` files are templates unless the startup log names one of them.

## Disable / rollback
Read `configPath` from the startup log, set the channel's `enabled` flag to `false` in that exact
file, and restart the bot. Confirm the adapter is absent from `/api/channels/status`; for the Mini
App, confirm `/api/miniapp/health` returns 404. Include `X-Phoenix-Token` when gateway authentication
is configured. Do not edit a checked-in template unless it is the logged active path.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
