# Channel Runbooks — Phoenix Echo Bot (the channel hub)

Shane's ruling (2/60): the echo bot is the connection between all terminals — **each channel gets its own small runbook.** These are those. One page each: purpose/scope, HONEST current state (real vs scaffold, from the code not from hope), config key NAMES (values live in env/vault, never here), enable steps, verification, disable/rollback, escalation.

| Channel | State | Facing |
|---|---|---|
| [TELEGRAM](TELEGRAM.md) | REAL (polling + Mini App forward to runtime intake) | Customer |
| [TEAMS](TEAMS.md) | REAL (Bot Framework, /api/messages) | Employee |
| [WHATSAPP](WHATSAPP.md) | UNWIRED scaffold — implementation file is not registered | Customer |
| [OUTLOOK](OUTLOOK.md) | SCAFFOLD — do not enable expecting behavior | Company mail |
| [MINI-APP](MINI-APP.md) | LIVE routes (submit→runtime intake, chat→agent) + thin wrapper | Customer |
| [COMMAND-APP](COMMAND-APP.md) | App goes runtime-direct; bot layer scaffold (convergence = design call) | Employee |

Shared substrate: the bot serves on `:18790`; the Phoenix runtime it fronts is `phoenix.runtime.app:gateway` on `:9120` (`runtime{}` block in config). Secrets: slots only, vault-held, never committed.
## Disable / rollback
- Telegram and Teams: set their own `channels.<name>.enabled` false and restart.
- Mini App HTTP routes: set `channels.miniApp.enabled` false and restart.
- WhatsApp, Outlook, and Command App: no live bot surface is registered; their placeholder flags are not a
  rollback mechanism.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
