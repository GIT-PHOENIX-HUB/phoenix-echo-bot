/**
 * Phoenix Echo Gateway — REST API Contracts
 *
 * Canonical REST endpoint contracts for all app surfaces.
 * New endpoints MUST use the standard response envelope.
 * Existing endpoints adopt it when touched for other reasons.
 */

// ── Standard Response Envelope ──
export function envelope({ success = true, data = null, error = null, requestId = '' }) {
  return {
    success,
    data,
    error,
    requestId,
    timestamp: new Date().toISOString()
  };
}

// ── Error Code Taxonomy ──
export const ERROR_CODES = {
  AUTH_MISSING:       { code: 'AUTH_MISSING',       status: 401, retryable: false },
  AUTH_EXPIRED:       { code: 'AUTH_EXPIRED',       status: 401, retryable: false },
  AUTH_INVALID:       { code: 'AUTH_INVALID',       status: 403, retryable: false },
  VALIDATION_FAILED:  { code: 'VALIDATION_FAILED',  status: 400, retryable: false },
  MISSING_FIELD:      { code: 'MISSING_FIELD',      status: 400, retryable: false },
  UPSTREAM_TIMEOUT:   { code: 'UPSTREAM_TIMEOUT',   status: 502, retryable: true },
  UPSTREAM_ERROR:     { code: 'UPSTREAM_ERROR',     status: 502, retryable: true },
  MODEL_RATE_LIMITED: { code: 'MODEL_RATE_LIMITED', status: 429, retryable: true },
  INTERNAL_ERROR:     { code: 'INTERNAL_ERROR',     status: 500, retryable: true },
  SERVICE_UNAVAILABLE:{ code: 'SERVICE_UNAVAILABLE',status: 503, retryable: true }
};

// ── Auth Methods by Surface ──
export const AUTH_METHODS = {
  COMMAND_APP:       'MSAL bearer token (Azure AD)',
  MINI_APP:          'Telegram initData validation (X-Telegram-Init-Data header)',
  GATEWAY_INTERNAL:  'Token/bearer (X-Phoenix-Token header)'
};

// ── Endpoint Map ──
export const ENDPOINTS = {
  // Gateway internal
  'POST /api/chat':                'Chat message (GATEWAY_INTERNAL)',
  'GET /api/sessions':             'List sessions (GATEWAY_INTERNAL)',
  'GET /api/sessions/:id':         'Load session (GATEWAY_INTERNAL)',
  'POST /api/sessions':            'Create session (GATEWAY_INTERNAL)',
  'POST /api/sessions/rename':     'Rename session (GATEWAY_INTERNAL)',
  'POST /api/sessions/:id/compact':'Compact session (GATEWAY_INTERNAL)',
  'GET /api/cron/jobs':            'List cron jobs (GATEWAY_INTERNAL)',
  'GET /api/channels/status':      'Channel status (GATEWAY_INTERNAL)',
  'GET /health':                   'Health check (no auth)',
  'POST /api/messages':            'Teams Bot Framework (adapter auth)',
  // MiniApp
  'POST /api/miniapp/submit':      'MiniApp submission (MINI_APP)',
  'POST /api/miniapp/chat':        'MiniApp chat (MINI_APP)',
  'GET /api/miniapp/products':     'Product catalog (MINI_APP)',
  'GET /api/miniapp/nec':          'NEC code lookup (MINI_APP)',
  'POST /api/miniapp/quotes':      'Quote request (MINI_APP)',
  'GET /api/miniapp/job-status':   'Job status (MINI_APP)',
  // Command App -> Azure Functions
  'POST /api/timeclock':           'Clock in/out (COMMAND_APP)',
  'POST /api/dailylog':            'Daily work log (COMMAND_APP)',
  'POST /api/orchestrate':         'AI orchestrator (COMMAND_APP)'
};
