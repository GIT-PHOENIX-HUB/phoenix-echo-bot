# Product Bible — phoenix-echo-bot
**Owner:** GIT-PHOENIX-HUB | **Last Updated:** 2026-03-27

## Purpose

phoenix-echo-bot (package name: `phoenix-echo-gateway`) is a self-hosted, sovereign AI agent gateway built for Phoenix Electric LLC. It receives messages from multiple channels (webchat, Microsoft Teams, Telegram, WhatsApp), routes them through Phoenix Echo (the AI agent running on the Anthropic Claude API via OAuth), executes tools on the host system, and delivers responses back. The gateway is workspace-driven: a set of markdown files in a designated workspace directory defines the agent's identity, memory, and behavior — making it deployable as any persona without changing code. It is the runtime backbone of the Phoenix Electric AI operation, currently deployed on the Mac Studio and mirrored to the VPS.

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js (ESM) | 22.x |
| HTTP Framework | Express | ^4.21.0 |
| WebSocket | ws | ^8.18.0 |
| AI Provider SDK | @anthropic-ai/sdk | ^0.35.0 |
| Teams Channel | botbuilder (Microsoft Bot Framework) | ^4.23.0 |
| Telegram Channel | node-telegram-bot-api | ^0.66.0 |
| WhatsApp Channel | whatsapp-web.js | ^1.26.0 |
| Scheduling | node-schedule | ^2.1.1 |
| Rate Limiting | express-rate-limit | ^8.2.1 |
| CI/CD | GitHub Actions | — |
| Deploy Target | Mac Studio (primary), VPS (satellite) | — |

## Architecture

The gateway is a single Node.js process. Express handles HTTP; a `ws` WebSocketServer is layered on top of the same HTTP server. On startup, `config.js` loads a JSON config (with `env:` references for all secrets), then `auth.js` resolves the Anthropic OAuth token. `prompt.js` assembles the system prompt from workspace markdown files. `session.js` manages per-conversation JSONL files and crash-recovery checkpoints. `agent.js` runs the Claude agentic loop — sending messages, executing tool calls, and feeding results back. `channels-integration.js` starts the ChannelsManager, which instantiates the Teams, Telegram, and WhatsApp adapters and a `CronScheduler`. `runbooks.js` exposes PowerShell automation runbooks to the agent. `brain-blueprint.js` manages the Brain Blueprint checklist state.

```
phoenix-echo-bot/
├── src/
│   ├── index.js               # Entry point — Express + WebSocket server, session routing, OAuth auth
│   ├── agent.js               # AgentRunner — Claude API agentic loop with retry + 3-failure rule
│   ├── auth.js                # OAuth token resolution (profile JSON or env var)
│   ├── brain-blueprint.js     # Brain Blueprint checklist state management
│   ├── channels-integration.js # ChannelsManager — Teams, Telegram, WhatsApp dispatch
│   ├── channels/
│   │   ├── teams.js           # Microsoft Teams Bot Framework adapter
│   │   ├── telegram.js        # Telegram long-polling adapter
│   │   └── whatsapp.js        # WhatsApp Web adapter (QR pairing)
│   ├── config.js              # Config loader + hot-reload watcher
│   ├── cron.js                # CronScheduler + overnight intel job definitions
│   ├── logger.js              # Structured JSON logger
│   ├── prompt.js              # System prompt assembly from workspace markdown files
│   ├── runbooks.js            # PowerShell runbook loader and executor
│   ├── session.js             # JSONL session persistence + checkpoint management
│   └── tools.js               # Tool definitions (exec, read, write, list, search) + executors
├── automation/
│   └── runbooks/              # 10 PowerShell runbooks (M365, ServiceFusion, reporting)
│       ├── MorningReport.ps1
│       ├── WeeklyReport.ps1
│       ├── TechnicianDailyReports.ps1
│       ├── InvoiceCollection.ps1
│       ├── SecuritySentinel.ps1
│       ├── Courier-SharePoint-Filing.ps1
│       ├── Process-Customers.ps1
│       ├── Receipt-Extractor.ps1
│       ├── MaintenanceCleanup.ps1
│       └── Phoenix-SharePoint-Theme.ps1
├── docs/
│   ├── phoenix-gateway-architecture.md   # 2,292-line architecture blueprint
│   ├── phoenix-gateway-roadmap.md        # Phased roadmap
│   ├── model-routing-strategy.md         # LLM routing strategy
│   ├── llm-provider-abstraction.md       # Multi-provider design
│   ├── v1.0-HARDENING-GUIDE.md
│   ├── phoenix-master-vision/            # Master vision + consolidation scripts
│   └── deep-research/                    # PhoenixOps AI Brain research artifacts
├── assets/
│   └── icons/                 # 4 PNG branding assets (phoenix-icon-4k.png + variants)
├── .github/
│   └── workflows/
│       ├── full-build-ci.yml      # Node 22 lint + smoke on PR and main push
│       └── consolidation_ci.yml   # Python manifest hash refresh on docs push
├── config.example.json        # Config template — all secrets use env: refs
├── config-studio.json         # Mac Studio deployment config (env: refs for secrets)
├── config-vps.json            # VPS deployment config (env: refs for secrets)
├── CODEOWNERS                 # @GIT-PHOENIX-HUB/humans-maintainers owns everything
├── BUILD_SPEC.md              # Original Codex build specification (2026-02-19)
├── CODEX_TRANSFER_HANDOFF_2026-02-21.md  # Session handoff doc (should move to docs/)
└── package.json
```

## Auth & Security

Authentication uses Anthropic OAuth 2.0 — not an API key. The OAuth bearer token is loaded via `auth.js` from an auth-profiles JSON file (`~/.phoenix-echo/auth-profiles.json`) or the `ANTHROPIC_AUTH_TOKEN` environment variable. All secrets in config files use `env:VAR_NAME` references — no raw credentials are committed. The gateway token (`PHOENIX_GATEWAY_TOKEN`) protects all `/api/*` and `/ws` endpoints using timing-safe comparison. Rate limiting is applied via `express-rate-limit`. Exec tool commands are validated against a blocked-pattern list (destructive commands, fork bombs, raw disk writes). Workspace boundary enforcement prevents read/write/list/search outside the configured workspace path. Sensitive-write guardrails block writes to `.env` and auth config files unless `PHOENIX_ALLOW_SENSITIVE_WRITES=true`.

Secrets are never committed. Config files use `env:` references throughout. All credential values are managed externally (environment variables on the host machine).

## Integrations

| Integration | Purpose |
|-------------|---------|
| Anthropic Claude API (OAuth) | Primary AI provider — Claude model inference |
| Microsoft Teams (Bot Framework) | Teams channel adapter — bidirectional messaging |
| Telegram | Telegram channel adapter — long-polling |
| WhatsApp Web | WhatsApp channel adapter — QR pairing |
| Microsoft 365 / SharePoint | PowerShell runbooks (MorningReport, Courier filing, etc.) |
| ServiceFusion | PowerShell runbooks (Process-Customers, InvoiceCollection) |
| Node.js cron scheduler | Overnight intel jobs, scheduled agent turns |
| phoenix-command-app | Front-end command app (separate repo) connects to gateway API |

## File Structure

| Path | Purpose |
|------|---------|
| `src/index.js` | Main entry point — HTTP + WebSocket server, session management, route handlers |
| `src/agent.js` | AgentRunner class — Claude agentic loop, retry logic, 3-failure rule |
| `src/auth.js` | OAuth token resolution — profile JSON or env var |
| `src/brain-blueprint.js` | Brain Blueprint checklist state tracking |
| `src/channels-integration.js` | ChannelsManager — initializes and dispatches across all channels |
| `src/channels/teams.js` | Microsoft Teams Bot Framework adapter |
| `src/channels/telegram.js` | Telegram long-polling adapter |
| `src/channels/whatsapp.js` | WhatsApp Web adapter |
| `src/config.js` | Config loader with env: ref resolution and hot-reload watcher |
| `src/cron.js` | CronScheduler class + overnight intel job factory |
| `src/logger.js` | Structured JSON logger (stdout + optional file) |
| `src/prompt.js` | System prompt assembly from workspace markdown files |
| `src/runbooks.js` | PowerShell runbook loader and executor |
| `src/session.js` | JSONL session persistence + crash-recovery checkpoints |
| `src/tools.js` | Tool definitions (exec, read, write, list, search) + executors with safety guards |
| `automation/runbooks/` | 10 PowerShell automation runbooks for M365 and ServiceFusion |
| `docs/` | Architecture blueprints, roadmap, deep-research artifacts |
| `assets/icons/` | Branding PNGs (phoenix-icon-4k.png and variants) |
| `.github/workflows/` | GitHub Actions CI — full-build and consolidation pipelines |
| `config.example.json` | Config template with all keys and env: ref placeholders |
| `config-studio.json` | Mac Studio deployment config |
| `config-vps.json` | VPS deployment config |
| `CODEOWNERS` | Repo ownership — @GIT-PHOENIX-HUB/humans-maintainers |
| `BUILD_SPEC.md` | Original build specification from Phoenix Echo to Codex (2026-02-19) |

## Current State

- **Status:** Active
- **Last Commit:** 2026-03-27 — Add CODEOWNERS for Phoenix Electric governance (b173154)
- **Open PRs:** 0 (both prior PRs merged — PR #1 disable-timeout, PR #2 declaration alignment)
- **Open Branches:** 9 remote branches — `channels/command-app`, `channels/mini-app`, `channels/outlook`, `channels/teams`, `channels/telegram`, `channels/whatsapp`, `claude/phoenix-parallel-build-8tcBF`, `feature/phoenix-apps-hardening-20260322-r2`. None merged.
- **Known Issues:**
  - No CLAUDE.md or AGENTS.md in repo (flagged in audit — MEDIUM priority)
  - 4 PNG branding assets >500KB committed to git (LOW — acceptable for now)
  - `CODEX_TRANSFER_HANDOFF_2026-02-21.md` in repo root instead of `docs/`
  - `docs/deep-research/` subtree is large research artifact archive — not production code
  - No test suite configured
  - No linter configured
  - Channel branches (`channels/*`) have not been merged — channel adapters may be incomplete or diverged

## Branding & UI

- Webchat UI served at `GET /` (public/index.html) — Phoenix-branded dark theme
- Phoenix Echo 4K mascot: `assets/icons/phoenix-icon-4k.png`
- Primary branding: Phoenix Echo Gateway, Phoenix Electric LLC
- Dashboard portal at `/dashboard` — gateway status, sessions, cron, memory health

## Action Log

| Date | Hash | Description |
|------|------|-------------|
| 2026-03-27 | b173154 | Add CODEOWNERS for Phoenix Electric governance |
| 2026-03-15 | a392651 | Merge PR #2 — fix-declaration-alignment-audit |
| 2026-03-15 | 7ce8dd1 | fix(declaration): align declaration strings across scripts and docs |
| 2026-03-15 | 82ce2a1 | Initial plan |
| 2026-03-15 | 02604ca | Merge PR #1 — claude/disable-timeout-7M48a |
| 2026-03-14 | 808c26d | Disable exec command timeout by default |
| 2026-03-03 | 042663a | Add full project — docs, automation, scripts, assets, configs |
| 2026-03-03 | 6a9588b | Initial commit — Phoenix Echo Bot core |

## Key Milestones

| Date | Milestone |
|------|-----------|
| 2026-02-19 | BUILD_SPEC.md written — Codex commissioned to build v1.0 |
| 2026-02-21 | CODEX_TRANSFER_HANDOFF — first handoff doc between Echo and Codex |
| 2026-02-22 | v1.0.0 built and declared — README authored by Phoenix Echo |
| 2026-03-03 | Full project pushed to GitHub — docs, automation, configs, assets |
| 2026-03-14 | Exec timeout disabled by default (PR #1 merged) |
| 2026-03-15 | Declaration strings aligned across all scripts and docs (PR #2 merged) |
| 2026-03-27 | CODEOWNERS added — Phoenix Electric governance model applied |
| 2026-03-27 | PRODUCT_BIBLE.md + BUILD_DOC.md added — Phase 3 governance docs |
