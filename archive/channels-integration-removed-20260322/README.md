# Archived: channels-integration.js (removed 2026-03-22)

## What was removed
`src/channels-integration.js` — ChannelsManager class that orchestrated WhatsApp,
Telegram, and Teams channels plus the cron scheduler.

## Why it was removed
- Imported `src/channels/whatsapp.js`, `src/channels/telegram.js`, `src/channels/teams.js`
  which did not exist. Would crash on init if any channel was enabled.
- Superseded by message-router.js + individual adapter pattern:
  - `src/message-router.js` — routes messages to registered adapters
  - `src/adapters/teams-adapter.js` — Teams Bot Framework adapter
- Cron scheduler moved to standalone initialization in index.js
