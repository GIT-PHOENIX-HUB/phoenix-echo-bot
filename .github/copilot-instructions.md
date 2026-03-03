# GitHub Copilot Instructions — Phoenix Echo Gateway

**Project:** Phoenix Echo Gateway  
**Owner:** Phoenix Electric LLC / Shane Warehime

This is a **production-grade, self-hosted AI agent gateway** for Phoenix Electric LLC. It proxies conversations to Anthropic Claude, persists sessions as append-only JSONL files, loads agent identity from workspace markdown files, serves a Phoenix-branded webchat UI, and supports channel adapters (Telegram, Microsoft Teams). This is not a hobby project — Phoenix Electric is a real business.

---

## Setup & Running

```bash
# Install dependencies
npm install

# Start the gateway (production)
npm start

# Start with auto-reload (development)
npm run dev
```

The server listens at `http://localhost:18790` by default.

> **No formal test suite exists yet.** Validate changes by booting the server (`npm start`) and exercising the relevant code path manually or via `curl`. The CI workflow in `.github/workflows/full-build-ci.yml` runs `npm run check` in the `Full-build/` subdirectory — run that against any changes made under `Full-build/`.

---

## Repository Layout

```
phoenix-echo-gateway/
├── src/
│   ├── index.js              # HTTP + WebSocket server, routing, auth middleware
│   ├── agent.js              # Claude API calls, agent loop, tool cycling
│   ├── session.js            # JSONL session create / load / append / checkpoint
│   ├── tools.js              # Built-in tools: exec, read, write, list, search
│   ├── prompt.js             # System prompt assembly from workspace markdown
│   ├── config.js             # Config loading, env-var resolution, hot-reload
│   ├── auth.js               # Anthropic OAuth / API key resolution
│   ├── logger.js             # Structured JSON logger
│   ├── channels-integration.js  # Teams + Telegram channel adapters
│   └── cron.js               # Cron scheduler (everyMs + cron-expression jobs)
├── public/
│   └── index.html            # Webchat UI (Phoenix-branded, dark theme)
├── workspace/                # Agent identity + memory files (loaded at runtime)
│   ├── SOUL.md
│   ├── AGENTS.md
│   ├── IDENTITY.md
│   ├── MEMORY.md
│   ├── TOOLS.md
│   ├── USER.md
│   ├── HEARTBEAT.md
│   └── memory/               # Daily memory files (YYYY-MM-DD.md)
├── docs/                     # Architecture blueprints (reference only)
├── assets/                   # Brand assets (phoenix-icon-4k.png)
├── BUILD_SPEC.md             # Full build specification
├── README.md                 # Setup + configuration reference
└── package.json
```

---

## Tech Stack

- **Runtime:** Node.js — plain JavaScript (`"type": "module"` — use ES module `import`/`export` syntax)
- **Key dependencies:** `@anthropic-ai/sdk`, `express`, `ws`, `node-telegram-bot-api`, `botbuilder`, `node-schedule`
- **No new dependencies** unless absolutely required — keep the footprint minimal
- **Logging:** Structured JSON to stdout + optional file (`/tmp/phoenix-echo/phoenix-echo-YYYY-MM-DD.log`)
- **Config:** `~/.phoenix-echo/config.json` + environment variables (env vars take precedence)
- **Sessions:** Append-only JSONL at `<workspace>/.phoenix-sessions/<sessionId>.jsonl`

---

## Coding Standards

1. Plain JavaScript — no TypeScript, no transpilation
2. ES module syntax (`import`/`export`) — no `require()`
3. Async/await everywhere; no raw Promise chains
4. Try/catch on every async block that touches I/O or external APIs
5. JSON structured logs with `timestamp`, `level`, `component`, `message` — use `src/logger.js`
6. No `rm` or destructive file operations — archive only (`mv` to `_ARCHIVE/`)
7. Workspace boundary enforcement: `read/write/list/search` must stay inside the workspace path
8. Dangerous shell patterns blocked in `exec` tool
9. Sensitive filenames (`.env`, auth configs) require `PHOENIX_ALLOW_SENSITIVE_WRITES=true`
10. Gateway token auth required on all `/api/*` and `WS /ws` endpoints (except `/api/messages` for Teams Bot Framework)
11. Correlation IDs (`x-request-id`) propagated through all HTTP flows
12. No leftover debug `console.log` — use the structured logger

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PHOENIX_GATEWAY_TOKEN` | Gateway auth token |
| `ANTHROPIC_AUTH_TOKEN` | Anthropic OAuth bearer token (preferred) |
| `ANTHROPIC_API_KEY` | Anthropic API key (legacy fallback) |
| `PHOENIX_WORKSPACE` | Workspace directory path |
| `PHOENIX_PORT` | Server port (default: 18790) |
| `PHOENIX_BIND` | Bind address (default: 127.0.0.1) |
| `ANTHROPIC_MODEL` | Model override (default: claude-sonnet-4-5-20250929) |
| `PHOENIX_ALLOW_SENSITIVE_WRITES` | Allow writes to `.env` / auth files |
| `PHOENIX_EXEC_ALLOW` | Optional regex allowlist for exec commands |
| `PHOENIX_MAX_EXEC_TIMEOUT_SEC` | Max exec timeout in seconds (default: 120) |

---

## Key Configuration Reference

```json
{
  "gateway": {
    "port": 18790,
    "bind": "127.0.0.1",
    "auth": { "mode": "token", "token": "<from env PHOENIX_GATEWAY_TOKEN>" }
  },
  "agent": {
    "model": "claude-sonnet-4-5-20250929",
    "maxIterations": 25,
    "threeFailureRule": true
  },
  "workspace": "/path/to/workspace",
  "cron": { "enabled": true, "jobs": [] },
  "logging": { "level": "info", "file": "/tmp/phoenix-echo/phoenix-echo.log" }
}
```

---

## Immutable Rules

These rules are non-negotiable — never introduce code that violates them:

| Rule | Description |
|------|-------------|
| NO DELETE | `rm` is never acceptable. Archive only (`mv` to `_ARCHIVE/`). |
| WORKSPACE ISOLATION | `read/write/list/search` must enforce workspace boundary — no path traversal |
| NO CREDENTIALS IN CODE | Secrets via env vars only — never hardcoded |
| THREE-FAILURE RULE | Three consecutive tool errors → stop and escalate. Never silently retry forever. |
| NO SILENT FAILURES | Every error must be logged. No swallowed exceptions. |
| AUTH ON API ENDPOINTS | `/api/*` and `WS /ws` always require gateway token (except Teams `/api/messages`) |

---

## Quality Bar

Shane's standard: **"high quality" and "just as robust" as OpenClaw**.

- No unhandled exceptions in any normal operation path
- No silent failures — every error logged
- Clean, readable code with meaningful comments
- Professional error messages to clients (no internal stack traces)
- Graceful degradation when external services (Claude API, Telegram, Teams) are unavailable
- Auth working correctly on all protected endpoints

---

## Gauntlet Review Protocol

When acting as an adversarial reviewer, work through every category before issuing a verdict:

### Review Checklist

#### ☐ Security
- Command injection via unsanitized inputs to `exec`
- Path traversal in `read/write/list` tools (escape from workspace boundary)
- Credential or token exposure in logs or error messages
- Auth bypass on protected endpoints
- XSS in webchat UI
- Secrets hardcoded in source

#### ☐ Logic
- Edge cases: empty input, null/undefined, empty arrays
- Error states handled (not just happy path)
- Race conditions in async code
- Session state corruption across concurrent requests
- Cron job overlap or double-scheduling

#### ☐ Performance
- N+1 file reads (reading workspace files on every request vs. caching)
- Unbounded loops or missing max-iteration guards
- Memory leaks (event listeners not cleaned up, intervals not cleared)

#### ☐ Standards
- Follows all coding standards listed above
- JSON logging format consistent
- No leftover debug `console.log` statements

#### ☐ Architecture
- Changes stay within single-responsibility boundaries
- Config-driven behavior — nothing that should be configurable is hardcoded
- Workspace boundary not weakened

### Verdict Format

Issue your verdict as `VERDICT.md`:

```
VERDICT: [APPROVE / REJECT / NEEDS_REVISION]
SESSION_ID: [session identifier]

SECURITY_ISSUES: [list or "None found"]
LOGIC_ISSUES: [list or "None found"]
PERFORMANCE_ISSUES: [list or "None found"]
STANDARDS_ISSUES: [list or "None found"]

BLOCKING_ISSUES: [Issues that MUST be fixed before approval — or "None"]
SUGGESTIONS: [Non-blocking improvements]

CONFIDENCE: [HIGH / MEDIUM / LOW]
NEXT_ACTION: [Manager: Return to Builder | Manager: Proceed to Production]
```

Any `BLOCKING_ISSUES` entry forces the verdict to `REJECT` or `NEEDS_REVISION`. No exceptions.
