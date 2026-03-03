# BUILD_SPEC.md — Phoenix Echo Gateway Build Specification

**For: Codex (Builder)**
**From: Phoenix Echo (Architect)**
**Date: 2026-02-19**

## Mission

Build a **general-purpose, production-grade AI agent gateway**. Not locked to one use case — the workspace markdown files define the agent's identity and purpose. Phoenix Electric is the first deployment, but this gateway should be able to power anything: business assistants, coding agents, home automation, creative tools, whatever comes next on the Mac Studio.

The MVP exists (978 lines across 6 files). Your job: harden it into production quality, add missing critical features, make the webchat/dashboard beautiful with Phoenix branding (as the default theme), and keep the architecture extensible.

**Think of it as a sovereign Phoenix-native gateway.** General architecture, specific configuration.

## Ground Rules

1. **Work on a feature branch** (e.g., `codex/build-v1`). Never push to main without Shane's approval.
2. **Keep it Node.js** — plain JavaScript, no TypeScript. Simple, readable, debuggable.
3. **Start from the existing MVP** in `src/` — don't rewrite from scratch. Harden and extend.
4. **Use the architecture docs** in `docs/` as reference. They're comprehensive (2,292+ lines of architecture blueprint).
5. **No external dependencies you don't need.** The MVP uses `@anthropic-ai/sdk` and `ws`. Add only what's necessary.
6. **Log everything.** Structured JSON logs to stdout/file.
7. **Test as you go.** At minimum, the server should boot and serve webchat without errors.

## What Exists (MVP)

| File | Lines | What It Does |
|------|-------|-------------|
| `src/index.js` | 154 | HTTP + WebSocket server, routing |
| `src/session.js` | 136 | JSONL session create/load/append |
| `src/agent.js` | 116 | Claude API calls, basic agent loop |
| `src/tools.js` | 252 | 5 tools: exec, read, write, list, search |
| `src/prompt.js` | 101 | System prompt from workspace markdown |
| `public/index.html` | 219 | Basic webchat UI |

## What Needs Building (Priority Order)

### P0 — Core Hardening (Do First)

1. **Auth system** — Token-based authentication for all endpoints using `gateway.auth.mode: "token"` and `gateway.auth.token: "<value>"`. Reject unauthenticated requests.

2. **Error handling & graceful shutdown** — Try/catch everywhere. SIGTERM/SIGINT handlers. Process-level uncaught exception handler. Never crash silently.

3. **Structured logging** — JSON logs with timestamp, level (INFO/WARN/ERROR/CRITICAL), component, message. Log to stdout and optionally to file (`/tmp/phoenix-echo/phoenix-echo-YYYY-MM-DD.log`).

4. **Config loading** — Load from `~/.phoenix-echo/config.json` (or env vars). Support: port, workspace path, anthropic API key, auth token, model name, max concurrent sessions.

5. **Session management hardening** — List sessions, resume sessions, session metadata (created, last message, message count). Compaction support (summarize old messages to stay within context).

6. **Agent loop hardening** — Max iterations (default 25). 3-failure rule (3 consecutive tool errors → stop). Streaming support for responses. Proper tool_use → tool_result cycling.

### P1 — System Prompt & Memory

7. **System prompt assembly** — Load from workspace markdown files in this order: SOUL.md, IDENTITY.md, AGENTS.md, USER.md, TOOLS.md, MEMORY.md, HEARTBEAT.md. Assemble into a deterministic, reproducible system prompt.

8. **Memory search** — Basic keyword/semantic search across MEMORY.md + memory/*.md files. Start with simple text search (grep-like); semantic embeddings can come later.

9. **Cron/heartbeat system** — Simple cron scheduler: define jobs with schedule (every X ms, or cron expression), payload (system event text or agent turn), session target. Heartbeat is just a cron job.

### P2 — Webchat UI & Branding

10. **Phoenix-branded webchat** — Replace the basic HTML with a professional, modern chat UI. Use the Phoenix Echo 4K mascot (`assets/icons/phoenix-icon-4k.png`). Dark theme preferred. Mobile-responsive. Show:
    - Phoenix Echo mascot in header
    - Chat interface with message bubbles
    - Typing indicator during agent turns
    - Tool execution indicators
    - "Phoenix Echo Gateway" branding

### P3 — Dashboard Portal

11. **Dashboard page** — Accessible at `/dashboard`. Shows:
    - Gateway status (uptime, version, model)
    - Active sessions (count, list)
    - Recent activity (last N messages across sessions)
    - Cron job status
    - Memory health (file count, last modified)
    - System resources (if easy to get)
    
12. **Phoenix AI Core integration** — The dashboard should feel like a command center, not a developer debug page. Professional quality. Phoenix branding throughout.

### P4 — Channel Adapters (Later — Don't Build Tonight Unless P0-P3 Done)

13. **WhatsApp adapter** — Shane's primary channel. Use the whatsapp-web.js library or similar.
14. **Teams adapter** — Business channel. Use Bot Framework SDK.

## Architecture Principles

- **Plugin-based channels** — Each channel (webchat, WhatsApp, Teams, Discord, etc.) is a self-contained adapter. Easy to add new ones.
- **LLM-agnostic** — Provider abstraction layer. Start with Anthropic/Claude, but design so OpenAI, Gemini, local models (Ollama) can slot in.
- **Workspace-driven identity** — The gateway loads markdown files from a workspace directory. Those files define WHO the agent is. Same gateway, different workspace = different agent.
- **Config over code** — Behavior should be configurable via JSON config, not hardcoded. If someone would want to change it between deployments, make it a config option.

## Configuration Schema

```json
{
  "gateway": {
    "port": 18790,
    "bind": "0.0.0.0",
    "auth": {
      "mode": "token",
      "token": "your-secret-token"
    }
  },
  "agent": {
    "model": "claude-sonnet-4-5-20250929",
    "maxIterations": 25,
    "threeFailureRule": true,
    "fallbacks": []
  },
  "workspace": "/path/to/workspace",
  "providers": {
    "anthropic": { "apiKey": "env:ANTHROPIC_API_KEY" },
    "openai": { "apiKey": "env:OPENAI_API_KEY" },
    "ollama": { "baseUrl": "http://localhost:11434" }
  },
  "channels": {},
  "logging": {
    "level": "info",
    "file": "/tmp/phoenix-echo/phoenix-echo.log"
  },
  "cron": {
    "jobs": []
  }
}
```

## Workspace Files (What Gets Loaded)

The gateway reads these files from the workspace directory to build the system prompt and provide agent context:

| File | Purpose | Required |
|------|---------|----------|
| SOUL.md | Agent personality/identity | Yes |
| IDENTITY.md | Agent identity card | No |
| AGENTS.md | Agent rules and conventions | Yes |
| USER.md | User profile and preferences | Yes |
| TOOLS.md | Tool-specific notes | No |
| MEMORY.md | Long-term memory | Yes |
| HEARTBEAT.md | Heartbeat checklist | No |
| memory/*.md | Daily memory files | No |

## Quality Bar

Shane's exact words: **"it has to be high quality"** and **"just as robust"** as enterprise-grade agent gateways.

This means:
- No unhandled exceptions
- No silent failures
- Clean, readable code with comments
- Professional UI (not a prototype aesthetic)
- Proper error messages to clients
- Graceful degradation when things break

## Reference Materials

- `docs/phoenix-gateway-architecture.md` — 2,292-line architecture blueprint
- `docs/llm-provider-abstraction.md` — 1,687-line multi-provider design
- `docs/model-routing-strategy.md` — 718-line routing strategy
- `docs/phoenix-gateway-roadmap.md` — 538-line phased roadmap
- Internal Phoenix architecture references and runbooks from prior gateway iterations

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Webchat UI |
| GET | `/health` | No | Health check |
| GET | `/dashboard` | Yes | Dashboard portal |
| POST | `/api/chat` | Yes | Send message (REST) |
| GET | `/api/sessions` | Yes | List sessions |
| GET | `/api/sessions/:id` | Yes | Get session details |
| WS | `/ws` | Yes | WebSocket chat |

## Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| PHOENIX_PORT | 18790 | Server port |
| PHOENIX_WORKSPACE | cwd | Workspace directory |
| ANTHROPIC_API_KEY | required | Claude API key |
| PHOENIX_AUTH_TOKEN | required | Gateway auth token |
| PHOENIX_MODEL | claude-sonnet-4-5-20250929 | Default model |
| PHOENIX_LOG_LEVEL | info | Log level |

## Definition of Done

- [ ] Server boots cleanly with `npm start`
- [ ] Auth rejects unauthenticated requests
- [ ] Webchat loads with Phoenix branding
- [ ] Can send a message and get a Claude response
- [ ] Tool execution works (exec, read, write)
- [ ] Sessions persist to JSONL
- [ ] Sessions can be listed and resumed
- [ ] System prompt loads from workspace files
- [ ] Dashboard shows gateway status
- [ ] Structured JSON logging works
- [ ] Graceful shutdown on SIGTERM
- [ ] No unhandled exceptions in normal operation

## Go Build It 🔥
