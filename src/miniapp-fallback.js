import { normalizeMiniAppSubmission } from './miniapp-routes.js';

export async function persistTelegramMiniAppFallback(persistence, message) {
  if (!persistence || typeof persistence.append !== 'function') {
    throw new Error('Mini App fallback persistence is unavailable');
  }

  let raw;
  try {
    raw = JSON.parse(String(message?.data || ''));
  } catch {
    throw new Error('Mini App fallback data is not valid JSON');
  }

  const normalized = normalizeMiniAppSubmission(raw);
  const chatId = String(message?.chatId || '').trim();
  if (!chatId) {
    throw new Error('Mini App fallback is missing its Telegram chat ID');
  }

  const receivedAt = new Date().toISOString();
  const sessionId = `miniapp-fallback-${chatId}`;
  await persistence.append(sessionId, {
    role: 'user',
    type: 'miniapp_fallback',
    content: JSON.stringify({
      submissionType: normalized.type,
      intakePath: normalized.path,
      body: normalized.body,
      telegramUserId: String(message?.userId || '') || null
    }),
    ts: receivedAt
  });

  return {
    sessionId,
    type: normalized.type,
    receivedAt
  };
}
