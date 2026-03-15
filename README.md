# Phoenix Echo Gateway

**Independent AI Gateway for Phoenix Electric LLC**

A self-hosted AI operationalsteward gateway built from scratch for full sovereignty.

## Status

- **Version:** 1.0.0
- **Built:** 2026-02-22
- **Author:** Phoenix Echo

## Quick Start

```bash
# Install dependencies
npm install

# Preferred: OAuth token (subscription account)
export ANTHROPIC_AUTH_TOKEN=your-oauth-access-token

# Optional: pin workspace for deterministic session recovery
export PHOENIX_WORKSPACE="/absolute/path/to/workspace"

# Optional: protect API/WS with a gateway token
export PHOENIX_GATEWAY_TOKEN="long-random-token"

# Start the gateway
npm start
```

Then open http://localhost:18790 for the webchat interface.

## Architecture

```
phoenix-echo-gateway/
├── src/
│   ├── index.js      # Main entry point, HTTP/WebSocket server
│   ├── session.js    # JSONL session management
│   ├── agent.js      # Claude API calls, agent loop
│   ├── tools.js      # Tool definitions and executors
│   └── prompt.js     # System prompt assembly from workspace
├── public/
│   └── index.html    # Webchat UI
└── package.json
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /api/chat` | Send message (REST) |
| `WS /ws` | WebSocket chat |
| `GET /api/channels/status` | Channel runtime status |
| `GET /` | Webchat UI |

## Configuration

Environment variables:
- `PHOENIX_PORT` — Server port (default: 18790)
- `PHOENIX_BIND` — Bind address (default: 127.0.0.1)
- `PHOENIX_WORKSPACE` — Workspace directory (default: gateway project root)
- `PHOENIX_GATEWAY_TOKEN` — If set, `/api/*` and `WS /ws` require this token
- `ANTHROPIC_AUTH_TOKEN` — OAuth bearer token (preferred)
- `PHOENIX_AUTH_PROFILE_PATH` — Path to Anthropic OAuth profile JSON (default: `~/.phoenix-echo/auth-profiles.json`)
- `PHOENIX_ANTHROPIC_PROFILE` — Preferred profile key (default: `anthropic:default`)
- `ANTHROPIC_API_KEY` — API key fallback only (legacy)
- `ANTHROPIC_MODEL` — Model to use (default: claude-sonnet-4-5-20250929)
- `PHOENIX_MODEL_RETRIES` — Claude request retry attempts for 429/5xx (default: 3)
- `PHOENIX_MODEL_RETRY_BASE_MS` — retry backoff base ms (default: 500)
- `PHOENIX_MAX_EXEC_TIMEOUT_SEC` — max `exec` timeout clamp (default: 120)
- `PHOENIX_EXEC_ALLOW` — optional regex allowlist for exec commands
- `PHOENIX_ALLOW_SENSITIVE_WRITES` — set `true` to allow writes to sensitive filenames
- `PHOENIX_TELEGRAM_ENABLED` — enable Telegram channel (`true|false`)
- `PHOENIX_TELEGRAM_BOT_TOKEN` — Telegram bot token
- `PHOENIX_TELEGRAM_POLL_INTERVAL_MS` — Telegram polling interval (default: 300)
- `PHOENIX_TEAMS_ENABLED` — enable Teams channel (`true|false`)
- `PHOENIX_TEAMS_APP_ID` — Teams Bot App ID
- `PHOENIX_TEAMS_APP_PASSWORD` — Teams Bot secret/password
- `PHOENIX_TEAMS_APP_TENANT_ID` — Teams tenant ID
- `PHOENIX_TEAMS_SERVICE_URL` — Teams service URL for proactive messaging

## Security Hardening (v1.0.0)

- Optional gateway token auth for API + WebSocket.
- Correlation IDs (`x-request-id`) for HTTP flows.
- Model request retry with exponential backoff for transient provider failures.
- Workspace boundary enforcement for `read/write/list/search`.
- Command policy controls + dangerous pattern blocking for `exec`.
- Sensitive-write guardrails for files like `.env` and auth configs.
- Gateway bind enforcement (`server.listen(PORT, BIND, ...)`)
- Teams webhook double-send guard to prevent crash on already-sent response.

## Session Recovery

- Conversations are append-only JSONL files in:
  - `<workspace>/.phoenix-sessions/<sessionId>.jsonl`
- Recovery checkpoints are written automatically:
  - `<workspace>/.phoenix-sessions/<sessionId>.checkpoint.json`
- Recovery endpoints:
  - `GET /api/sessions`
  - `GET /api/sessions/:sessionId`
  - `POST /api/sessions`
  - `GET /api/recovery`

If the CLI/browser crashes:
1. Restart gateway with the same `PHOENIX_WORKSPACE`.
2. Re-open web UI.
3. Select prior session from session dropdown.
4. History reloads from JSONL + checkpoint.

## Workspace Files

The gateway loads context from these markdown files:
- `SOUL.md` — Agent personality and identity
- `AGENTS.md` — Agent configuration and rules
- `USER.md` — User context and preferences
- `TOOLS.md` — Tool-specific notes
- `MEMORY.md` — Long-term memory
- `memory/YYYY-MM-DD.md` — Daily notes

## Tools

Built-in tools:
- `exec` — Execute shell commands
- `read` — Read file contents
- `write` — Write files
- `list` — List directory contents
- `search` — Search for text in files

## Why Phoenix Echo?

Phoenix Echo is:
- **Fully independent** — No runtime dependency on external gateway platforms
- **Self-hosted** — Runs on your own hardware
- **Open architecture** — Direct Claude API calls, no middleware
- **Sovereign** — Your data stays yours

## Roadmap

### v0.2.0
- [ ] Teams channel adapter
- [ ] Memory search (semantic)
- [ ] Cron jobs / heartbeat

### v0.3.0
- [ ] Multi-agent routing
- [ ] Browser automation
- [ ] Voice (TTS/STT)

## License

Proprietary — Phoenix Electric LLC
