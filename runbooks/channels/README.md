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
## Disable / rollback
Set the channel's `enabled` flag to `false` in the active config (`config-vps.json` / `config-studio.json`) and restart the bot — a disabled channel logs one "disabled in config" line and touches nothing. Rollback is always config-only; no code changes.

## Escalation
Channel down or misbehaving → post to the oversight channel (FORMATION/COMMS) with the bot log lines; secrets NEVER in the post. Credential slots live in the vault/env, never in this repo. Outbound to customers is draft-first wherever an approval surface exists — never auto-send beyond the channel's scoped, ruled behavior.
