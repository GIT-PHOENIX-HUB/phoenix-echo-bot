# Build Doc — phoenix-echo-bot
**Owner:** GIT-PHOENIX-HUB | **Last Updated:** 2026-03-27

## Objectives

1. Merge and stabilize all open channel branches (`channels/teams`, `channels/telegram`, `channels/whatsapp`, `channels/command-app`, `channels/mini-app`, `channels/outlook`) into main — currently diverged and unmerged.
2. Apply the `feature/phoenix-apps-hardening-20260322-r2` hardening branch changes into main.
3. Add CLAUDE.md / AGENTS.md governance doc to the repo root (flagged MEDIUM in audit).
4. Establish a working test suite — at minimum boot-level smoke tests and tool execution tests.
5. Configure a linter (ESLint) enforcing consistent code style across all 12 `src/` modules.
6. Resolve the `docs/deep-research/` archival question — either remove from the repo or explicitly designate as a frozen archive subdirectory.
7. Move `CODEX_TRANSFER_HANDOFF_2026-02-21.md` from repo root to `docs/`.

## End State

The gateway is a production-grade, fully tested, multi-channel AI agent runtime. All channel adapters (Teams, Telegram, WhatsApp, webchat) are stable and merged to main. The codebase has a passing CI pipeline that enforces lint and runs smoke tests on every PR. The repo has a CLAUDE.md / AGENTS.md so any agent entering cold knows the rules. The `channels/*` and `feature/*` branches are either merged or archived. Large binary assets and deep-research artifacts are either relocated or explicitly frozen. The gateway deploys cleanly to both Mac Studio and VPS from a single config swap.

## Stack Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | JavaScript (Node.js ESM), no TypeScript | Explicit BUILD_SPEC.md rule — keep it simple, readable, debuggable |
| AI Provider | Anthropic Claude via OAuth | Subscription account, cost control — NEVER use raw API key on VPS |
| HTTP Framework | Express | Established, minimal, sufficient for this workload |
| WebSocket | ws | Lightweight, no abstraction overhead |
| Teams Channel | Microsoft Bot Framework (botbuilder) | Required for Teams integration — no viable alternative |
| WhatsApp Channel | whatsapp-web.js | Best available open implementation for WhatsApp Web pairing |
| Scheduling | node-schedule | Cron expression support, no external dependency needed |
| Config | JSON with env: refs | Allows deployment-specific configs without committing secrets |
| Logging | Custom structured JSON logger | Consistent log shape across all modules |
| Test Framework | NEEDS SHANE INPUT | No test framework configured yet — Jest or Node's built-in test runner are candidates |
| Lint | NEEDS SHANE INPUT | ESLint recommended but not yet configured |

## Architecture Targets

- **Channel consolidation:** Merge all `channels/*` remote branches. Each channel adapter lives in `src/channels/`. The ChannelsManager in `channels-integration.js` is already the right abstraction — the adapters just need to be stabilized and merged.
- **LLM provider abstraction:** `docs/llm-provider-abstraction.md` (1,687 lines) describes a provider-agnostic interface layer. The `config.providers` schema already supports Anthropic, OpenAI, and Ollama keys. The abstraction layer should be built out so the agent can route to alternate providers without hardcoding Anthropic paths.
- **Test layer:** Boot-level smoke test (server starts, `/health` returns 200, WebSocket accepts connection) plus tool execution unit tests (exec sandbox, read boundary enforcement, write sensitive-file block).
- **Lint enforcement:** Add ESLint to `package.json` scripts. Enforce in CI via the `full-build-ci.yml` workflow's `npm run check` step.
- **Memory search:** `docs/phoenix-gateway-roadmap.md` roadmap calls for semantic memory search across workspace markdown files. Initial implementation: keyword/grep-style search. Semantic embeddings deferred.
- **Multi-agent routing:** Planned in roadmap v0.3.0. Defer until channel layer is stable.
- **Voice (TTS/STT):** Planned in roadmap v0.3.0. Defer.

## Success Criteria

- [ ] All `channels/*` remote branches merged or explicitly archived
- [ ] `feature/phoenix-apps-hardening-20260322-r2` reviewed and merged or closed
- [ ] CLAUDE.md / AGENTS.md added to repo root
- [ ] Linter (ESLint) configured and passing in CI
- [ ] Smoke test suite runs in CI — server boots, /health 200, WebSocket connects
- [ ] `CODEX_TRANSFER_HANDOFF_2026-02-21.md` moved from root to `docs/`
- [ ] `docs/deep-research/` status decided (archive designation or removal)
- [ ] Gateway deploys cleanly on both Mac Studio (config-studio.json) and VPS (config-vps.json)
- [ ] No unhandled exceptions in normal operation under all active channels
- [ ] All secrets remain env: refs — no raw credentials in any committed file

## Dependencies & Blockers

| Dependency | Status | Owner |
|-----------|--------|-------|
| Channel branch review — determine which are production-ready vs. prototype | Blocked — needs triage | Shane |
| `feature/phoenix-apps-hardening-20260322-r2` — review scope and merge readiness | Blocked — needs review | Shane / Echo |
| LLM provider abstraction implementation | Pending — design exists in docs | Echo / Codex |
| Test framework selection (Jest vs. Node built-in) | NEEDS SHANE INPUT | Shane |
| ESLint config approval | NEEDS SHANE INPUT | Shane |
| `docs/deep-research/` disposition — keep, freeze, or relocate | NEEDS SHANE INPUT | Shane |
| Voice (TTS/STT) integration | Deferred — not started | NEEDS SHANE INPUT for timeline |
| Multi-agent routing | Deferred — not started | NEEDS SHANE INPUT for timeline |
| Outlook channel (`channels/outlook` branch) — scope unclear | NEEDS SHANE INPUT | Shane |

## Change Process

All changes to this repository follow the Phoenix Electric governance model:

1. **Branch:** Create feature branch from `main`
2. **Develop:** Make changes with clear, atomic commits
3. **PR:** Open pull request with description of changes
4. **Review:** Required approval from `@GIT-PHOENIX-HUB/humans-maintainers`
5. **CI:** All status checks must pass (when configured)
6. **Merge:** Squash merge to `main`
7. **No force push.** No direct commits to `main`. No deletion without `guardian-override-delete` label.

## NEEDS SHANE INPUT

- **Test framework:** Jest or Node.js built-in `node:test`? Should tests run locally only or also in CI?
- **ESLint ruleset:** Standard, Airbnb, or custom? Enforce on all `src/` modules?
- **Channel branch triage:** Which of the 6 `channels/*` branches are production-ready and should be merged? Which are prototypes to archive?
- **Outlook channel scope:** The `channels/outlook` branch exists — is Outlook a planned channel or was this exploratory?
- **deep-research/ disposition:** Keep in repo as frozen archive, move to OneDrive/SharePoint, or remove entirely?
- **Voice channel timeline:** Is TTS/STT on the active roadmap, or deferred indefinitely?
- **Multi-agent routing timeline:** Same question — active or indefinitely deferred?
- **VPS deployment status:** Is the gateway currently running on the VPS, or only on Mac Studio?
- **Overnight intel cron jobs:** Are the `createOvernightIntelJobs` jobs fully configured and running, or still scaffolded?
