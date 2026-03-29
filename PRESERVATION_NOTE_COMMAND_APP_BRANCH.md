# Preservation Note — channels/command-app Branch
**Date:** 2026-03-28 | **Found by:** Wave B investigation

## Location
- **Repo:** phoenix-echo-bot
- **Branch:** `channels/command-app`
- **Key file:** `src/channels/command-app.js`

## What It Is
A scaffold adapter between the Phoenix Command App PWA (`phoenix-command-app` repo) and the Phoenix Echo Bot core. It defines the bot-side API that the Command App calls.

## Unique Details (not in main or any other repo)
- `CommandAppChannel` class with gateway integration
- REST API endpoint handler (`handleApiRequest`) for chat/commands
- WebSocket handler (`handleWebSocket`) for real-time updates
- Auth model: MSAL / gateway token validation
- Config path: `config.channels.commandApp.enabled`

## Status
SCAFFOLD — the class structure and integration pattern are defined but TODO stubs remain. No functional code yet.

## Other Channel Branches (same pattern)
```
channels/command-app  ← THIS ONE
channels/mini-app
channels/outlook
channels/teams
channels/telegram
channels/whatsapp
```

## Action
DO NOT delete or merge this branch without Shane's review. This is part of the pipeline architecture: Bot → Gateway → Command App. The adapter is how the Command App connects to the bot.

## Pipeline Relevance
When Wave 4 (Pipeline Wiring) executes, this adapter is where the Command App integration gets built out. The scaffold defines the interface contract.
