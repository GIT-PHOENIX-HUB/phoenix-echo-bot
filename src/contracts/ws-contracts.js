/**
 * Phoenix Echo Gateway — WebSocket Message Contracts
 *
 * Canonical WS message schema. Gateway accepts both `type: "message"` (legacy)
 * and `type: "chat"` (new) — both normalized to canonical schema internally.
 */

export const CLIENT_MESSAGE_TYPES = {
  AUTH: 'auth',
  SESSION: 'session',
  NEW_SESSION: 'new_session',
  LIST_SESSIONS: 'list_sessions',
  RENAME_SESSION: 'rename_session',
  HISTORY: 'history',
  CHAT: 'chat',
  MESSAGE: 'message', // legacy alias
};

export const SERVER_EVENT_TYPES = {
  RESPONSE: 'response',
  ERROR: 'error',
  TYPING: 'typing',
  HEARTBEAT: 'heartbeat',
  SESSION: 'session',
  SESSIONS: 'sessions',
  HISTORY: 'history',
  AUTH: 'auth',
};

export function normalizeClientMessage(raw) {
  if (!raw || typeof raw !== 'object') return { type: 'unknown', content: '' };
  if (raw.type === 'message') return { ...raw, type: 'chat', content: raw.content || raw.text || '' };
  if (raw.type === 'chat') return { ...raw, content: raw.content || raw.text || '' };
  return raw;
}

export function createResponseEvent(content, sessionId, requestId) {
  return { type: 'response', content, sessionId, requestId };
}

export function createErrorEvent(message, code = null) {
  return { type: 'error', message, ...(code && { code }) };
}

export function createTypingEvent(status) {
  return { type: 'typing', status };
}

export function createHeartbeatEvent() {
  return { type: 'heartbeat', ts: new Date().toISOString() };
}

export function createSessionEvent(sessionId, messageCount, checkpoint = null) {
  return { type: 'session', sessionId, messageCount, ...(checkpoint && { checkpoint }) };
}
