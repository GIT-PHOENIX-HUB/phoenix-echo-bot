# VERIFICATION.md — Phoenix Echo Bot Triage Pass
**Date:** 2026-03-28
**Scope:** Wave B — protected local pass. No push. No delete. Clean carefully.
**Status:** COMPLETE

---

## 1. Repo Overview

- **Deployment:** Azure (live — DO NOT break)
- **Auth:** OAuth via Azure Key Vault (ANTHROPIC_AUTH_TOKEN env var or ~/.phoenix-echo/auth-profiles.json)
- **Entry point:** `src/index.js` — Express + WebSocket gateway
- **Agent core:** `src/agent.js` — AgentRunner class with retry, tool loop, 3-failure circuit breaker
- **Tools:** `src/tools.js` — exec, read, write, list, search (workspace-sandboxed)
- **Model pinned to:** claude-sonnet-4-5-20250929

---

## 2. Branch Inventory

Local branches:
- `main` (current, checked out)
- `governance-docs`

Remote branches (all prefixed `remotes/origin/`):
| Branch | Status | Contents |
|--------|--------|----------|
| `channels/command-app` | remote only | src/channels/command-app.js scaffold |
| `channels/mini-app` | remote only | src/channels/mini-app.js scaffold |
| `channels/outlook` | remote only | src/channels/outlook.js — SCAFFOLD, TODO everywhere |
| `channels/teams` | remote only | src/channels/teams.js — BotFrameworkAdapter, functional |
| `channels/telegram` | remote only | src/channels/telegram.js — node-telegram-bot-api, functional |
| `channels/whatsapp` | remote only | src/channels/whatsapp.js — whatsapp-web.js + puppeteer, functional |
| `claude/phoenix-parallel-build-8tcBF` | remote only | unknown contents |
| `feature/phoenix-apps-hardening-20260322-r2` | remote only | unknown contents |
| `governance-docs` | local + remote | governance docs |
| `main` | local + remote | primary production code |

Note: `channels/whatsapp`, `channels/telegram`, `channels/teams` are the three functional channel implementations. They exist only on remote branches — NOT yet merged to main. `channels-integration.js` on main imports from `./channels/whatsapp`, `./channels/telegram`, `./channels/teams` but the `src/channels/` directory does not exist on main. This means main will throw on boot if any channel is `enabled: true`. All channels default to `enabled: false` so Azure is safe.

---

## 3. File Count

Root-level tracked files (excluding .git): 83 files total

| Location | Count |
|----------|-------|
| src/ | 12 files |
| docs/ | 22 files |
| automation/runbooks/ | 11 files |
| scripts/ | 2 files |
| assets/icons/ | 1 file (after triage — 4k images moved) |
| .github/ | 3 files |
| Root markdown/config | 9 files |

---

## 4. Channel Scope Requirements

Shane's 7 channels — current state and reconnection needs:

| Channel | Branch | Impl State | Azure Creds Needed | Notes |
|---------|--------|------------|-------------------|-------|
| Teams | channels/teams | Functional (BotFrameworkAdapter) | PHOENIX_TEAMS_APP_ID, PHOENIX_TEAMS_APP_PASSWORD, PHOENIX_TEAMS_APP_TENANT_ID | Needs merge to main; route /api/messages |
| Telegram | channels/telegram | Functional (long polling) | PHOENIX_TELEGRAM_BOT_TOKEN | Needs merge to main |
| WhatsApp | channels/whatsapp | Functional (puppeteer/QR) | Session dir + puppeteer executable | Needs merge; headless browser on Azure |
| Command-App | channels/command-app | Scaffold only | TBD | Not yet implemented |
| Mini-App | channels/mini-app | Scaffold only | TBD | Not yet implemented |
| Outlook | channels/outlook | SCAFFOLD — all TODO | Microsoft Graph: Mail.Read, Mail.Send, OAuth same tenant as Teams | No real code yet |
| iMessages | none | NO CODE EXISTS | Apple Business Register or local Mac bridge | Requires separate implementation |

Config keys already wired in `src/config.js` for: whatsapp, telegram, teams.
Config keys NOT YET wired for: command-app, mini-app, outlook, iMessages.

Gateway reconnection path: credentials go in Azure App Service environment variables or Key Vault. OAuth token is already wired via ANTHROPIC_AUTH_TOKEN.

---

## 5. Triage Folder Actions

### archive_for_review/ (3 files moved)
Large PNGs that are not referenced by any source code or config:
- `phoenix-icon-4k.png` — 11MB, raw 4K source asset
- `phoenix-icon-4k-transparent.png` — 7.5MB, raw 4K transparent source asset
- `phoenix-logo-new.png` — 2MB, logo source

**Retained in assets/icons/:**
- `phoenix-teams-icon-FINAL.png` — 648KB, Teams bot icon, may be referenced in Teams app manifest

### archive_for_delete/ (empty — nothing destroyed)
No files moved here. Nothing confirmed dead with zero value. Waiting for Shane's review.

### scheduled_to_relocate/ (empty — nothing moved yet)
Candidates for relocation (not moved, flagged only):
- `docs/deep-research/PhoenixOps_AI_Brain/` — 20+ files, looks like a separate research project dropped into this repo. Candidate for `~/Documents/PROJECTS/`
- `docs/deep-research/SESSION_HANDOFF_2026-01-31.md` — session handoff doc, belongs in Gateway
- `CODEX_TRANSFER_HANDOFF_2026-02-21.md` — session handoff doc, belongs in Gateway
- `docs/TONIGHT_FIELD_ACCESS_PLAN_2026-02-22.md` — planning doc, belongs in Gateway
- `config-studio.json` / `config-vps.json` — machine-specific configs, could live in Gateway

---

## 6. Issues Found

### CRITICAL (affects boot)
1. **Missing src/channels/ on main** — channels-integration.js imports from `./channels/whatsapp`, `./channels/telegram`, `./channels/teams`. These files don't exist on main. If any channel is enabled in config, the bot will crash on start. Currently safe because all default to `enabled: false`. MUST merge channel branches before enabling.

### MEDIUM
2. **expandHome() duplicated** — defined identically in both `src/auth.js` (line 15) and `src/index.js` (line 138). Extract to config.js (already has it as an export) or a shared util.
3. **logEvent() legacy wrapper in index.js** — lines 113-136 wrap the logger but serve no purpose since logger is used directly everywhere else. Dead compatibility shim.
4. **outlook and iMessages have NO implementation** — outlook.js is all TODO stubs. iMessages doesn't exist at all. These are future work, not reconnection items.

### LOW
5. **docs/deep-research/PhoenixOps_AI_Brain/** — 20-file AI brain research bundle sitting inside the bot repo. Unrelated to bot runtime.
6. **build_pricebook.py** in docs/deep-research — Python script with no connection to Node.js gateway.
7. **CODEX_TRANSFER_HANDOFF_2026-02-21.md** in root — session handoff file, not a repo doc.

---

## 7. What Is Clean and Should Not Be Touched

- `src/index.js` — live production gateway, handles Express + WS + auth + sessions
- `src/agent.js` — AgentRunner, solid with retry and 3-failure rule
- `src/tools.js` — workspace-sandboxed tool execution, well-hardened
- `src/auth.js` — OAuth-first resolver, correct
- `src/config.js` — deep merge + hot reload, correct
- `src/session.js`, `src/logger.js`, `src/prompt.js`, `src/cron.js` — supporting modules
- `src/runbooks.js`, `src/brain-blueprint.js` — supporting modules
- `package.json` — deps look right (botbuilder, whatsapp-web.js, node-telegram-bot-api, express, ws)
- `automation/runbooks/` — PowerShell runbooks for SharePoint/SF automation, separate concern, keep
- `.github/workflows/` — CI pipelines, do not touch
- `PRESERVATION_NOTE_COMMAND_APP_BRANCH.md` — existing, not duplicated per task spec

---

## 8. Gateway Reconnection Checklist (for future pass)

To reconnect channels to Azure:
1. Merge `channels/teams` into main (or cherry-pick `src/channels/teams.js`)
2. Merge `channels/telegram` into main
3. Merge `channels/whatsapp` into main (test headless browser on Azure first)
4. Set Azure App Service environment variables:
   - ANTHROPIC_AUTH_TOKEN (from Azure Key Vault → PhoenixAiVault → authToken)
   - PHOENIX_TEAMS_APP_ID / PHOENIX_TEAMS_APP_PASSWORD / PHOENIX_TEAMS_APP_TENANT_ID
   - PHOENIX_TELEGRAM_BOT_TOKEN
   - PHOENIX_GATEWAY_TOKEN (gateway auth)
5. Enable channels in config: `channels.teams.enabled: true`, etc.
6. Outlook and iMessages = new build work, not reconnection

---

*Protected pass complete. No bot code modified. No commits made. Local only.*
