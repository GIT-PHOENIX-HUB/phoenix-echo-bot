/**
 * Phoenix Echo Gateway - Mini App Routes
 *
 * REST API endpoints for the Telegram Mini App (phoenix-electric-miniapp).
 */

import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger();

const MAINTENANCE_SERVICE_KEYS = {
  GEN_MAINT: 'annual',
  GEN_BATT: 'battery',
  GEN_WIFI: 'wifi',
  GEN_LOAD_SHED: 'load-shed',
  GEN_WARRANTY_EXT: 'warranty',
  GEN_REPAIR: 'repair'
};

function normalizedType(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_');
}

function generatorCoverage(value) {
  const key = String(value || '').trim().toLowerCase();
  return {
    essential: 'essentials',
    essentials: 'essentials',
    managed: 'managed_whole_home',
    managed_whole_home: 'managed_whole_home',
    full: 'full_whole_home',
    full_whole_home: 'full_whole_home'
  }[key] || 'managed_whole_home';
}

export function normalizeMiniAppSubmission(data) {
  const type = normalizedType(data?.type);
  if (type === 'service_request') {
    return {
      type,
      path: '/v1/intake/service-request',
      body: {
        category: String(data?.category || ''),
        urgency: String(data?.urgency || 'flexible'),
        property_type: String(data?.property_type || data?.property || 'residential'),
        description: String(data?.description || data?.notes || '') || null,
        name: String(data?.name || ''),
        phone: String(data?.phone || ''),
        address: String(data?.address || '') || null
      }
    };
  }

  if (type === 'generator_lead' || type === 'size' || type === 'sizing') {
    const path = type === 'generator_lead' ? '/v1/intake/generator-lead' : '/v1/intake/size';
    return {
      type,
      path,
      body: {
        sqft: Number(data?.sqft || 0),
        load_watts: Number(data?.load_watts ?? data?.totalLoadWatts ?? 0),
        coverage: generatorCoverage(data?.coverage),
        name: String(data?.name || ''),
        phone: String(data?.phone || '')
      }
    };
  }

  if (
    type === 'maintenance_request'
    || type === 'maintenance_booking'
    || type === 'maintenance'
  ) {
    const serviceKey = String(
      data?.service_key
      || data?.serviceKey
      || MAINTENANCE_SERVICE_KEYS[data?.serviceCode]
      || ''
    );
    return {
      type: 'maintenance_request',
      path: '/v1/intake/maintenance',
      body: {
        service_key: serviceKey,
        name: String(data?.name || ''),
        phone: String(data?.phone || ''),
        model: String(data?.model || data?.generatorModel || '') || null,
        address: String(data?.address || '') || null
      }
    };
  }

  if (type === 'quote_request') {
    throw new Error('quote_request is not accepted by submit; use /api/miniapp/quotes');
  }
  throw new Error(`Unsupported Mini App submission type: ${type || '(missing)'}`);
}

export function configuredMiniAppOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Mini App allowed origin must be an absolute HTTP(S) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Mini App allowed origin must use HTTP(S)');
  }
  return parsed.origin;
}

function applySubmissionCors(req, res, allowedOrigin) {
  const requestOrigin = String(req.get('Origin') || '').trim();
  if (!requestOrigin) {
    return true;
  }
  if (!allowedOrigin || requestOrigin !== allowedOrigin) {
    res.status(403).json({
      success: false,
      error: 'Mini App origin is not allowed',
      requestId: req.requestId
    });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  return true;
}

class MiniAppForwardError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export async function forwardMiniAppSubmission(data, context = {}) {
  const {
    runtime,
    initData = '',
    requestId = '',
    fetchImpl = fetch
  } = context;
  let normalized;
  try {
    normalized = normalizeMiniAppSubmission(data);
  } catch (error) {
    throw new MiniAppForwardError(error.message, 400);
  }

  const baseUrl = String(runtime?.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new MiniAppForwardError('Backend not configured', 503);
  }

  const timeoutMs = Number(runtime?.timeoutMs ?? 10000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new MiniAppForwardError('Backend timeout is misconfigured', 503);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetchImpl(`${baseUrl}${normalized.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
        'X-Request-Id': requestId
      },
      body: JSON.stringify(normalized.body),
      signal: controller.signal
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      logger.error('MiniApp submit: runtime rejected', {
        status: upstream.status,
        requestId,
        detail: detail.slice(0, 300)
      });
      throw new MiniAppForwardError('Backend rejected submission');
    }
    const result = await upstream.json().catch(() => ({}));
    return { normalized, result };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new MiniAppForwardError('Backend timeout');
    }
    if (error instanceof MiniAppForwardError) {
      throw error;
    }
    throw new MiniAppForwardError('Backend unreachable');
  } finally {
    clearTimeout(timeoutId);
  }
}

export function registerMiniAppRoutes(app, deps = {}) {
  const {
    handleMessage,
    pluginManager,
    persistence,
    runtime,
    miniApp = {}
  } = deps;
  const allowedOrigin = configuredMiniAppOrigin(miniApp.allowedOrigin);

  app.options('/api/miniapp/submit', (req, res) => {
    if (!applySubmissionCors(req, res, allowedOrigin)) return;
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Telegram-Init-Data, X-Request-Id'
    );
    res.status(204).end();
  });

  app.post('/api/miniapp/submit', async (req, res) => {
    if (!applySubmissionCors(req, res, allowedOrigin)) return;
    try {
      const data = req.body;
      logger.info('MiniApp submission received', {
        type: data?.type,
        requestId: req.requestId
      });

      let forwarded;
      try {
        forwarded = await forwardMiniAppSubmission(data, {
          runtime,
          initData: req.get('X-Telegram-Init-Data') || '',
          requestId: req.requestId
        });
      } catch (error) {
        logger.error('MiniApp submit failed', {
          error: error.message,
          requestId: req.requestId
        });
        return res.status(error.status || 502).json({
          success: false,
          error: error.message,
          requestId: req.requestId
        });
      }
      res.json({
        success: true,
        data: {
          received: true,
          type: forwarded.normalized.type,
          runtime: forwarded.result
        },
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('MiniApp submit error', { error: error.message });
      res.status(502).json({ success: false, error: 'Backend unreachable', requestId: req.requestId });
    }
  });

  app.post('/api/miniapp/chat', async (req, res) => {
    try {
      if (!handleMessage) {
        return res.status(503).json({ success: false, error: 'Chat service unavailable', requestId: req.requestId });
      }
      const { message, sessionId } = req.body || {};
      if (!message) {
        return res.status(400).json({ success: false, error: 'Message required', requestId: req.requestId });
      }
      const safeSession = `miniapp-${sessionId || 'default'}`;
      const response = await handleMessage(safeSession, String(message), {
        requestId: req.requestId,
        channel: 'miniapp'
      });
      res.json({ success: true, data: { response }, requestId: req.requestId, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('MiniApp chat error', { error: error.message });
      res.status(500).json({ success: false, error: 'Chat processing error', requestId: req.requestId });
    }
  });

  app.get('/api/miniapp/products', (req, res) => {
    res.json({ success: true, data: { products: [] }, requestId: req.requestId, timestamp: new Date().toISOString() });
  });

  app.get('/api/miniapp/nec', (req, res) => {
    res.json({ success: true, data: { codes: [] }, requestId: req.requestId, timestamp: new Date().toISOString() });
  });

  app.post('/api/miniapp/quotes', async (req, res) => {
    res.json({ success: true, data: { quoteId: null }, requestId: req.requestId, timestamp: new Date().toISOString() });
  });

  app.get('/api/miniapp/job-status', (req, res) => {
    const jobId = req.query.jobId;
    res.json({ success: true, data: { jobId, status: null }, requestId: req.requestId, timestamp: new Date().toISOString() });
  });

  app.get('/api/miniapp/health', (req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', handleMessage: !!handleMessage, pluginManager: !!pluginManager, persistence: !!persistence },
      requestId: req.requestId, timestamp: new Date().toISOString()
    });
  });

  logger.info('MiniApp routes registered (7 endpoints)');
}
