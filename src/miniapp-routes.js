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
  const coverage = {
    essential: 'essentials',
    essentials: 'essentials',
    managed: 'managed_whole_home',
    managed_whole_home: 'managed_whole_home',
    full: 'full_whole_home',
    full_whole_home: 'full_whole_home'
  }[key];
  if (!coverage) {
    throw new Error(`Unsupported generator coverage: ${key || '(missing)'}`);
  }
  return coverage;
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
    return {
      type,
      path: type === 'generator_lead' ? '/v1/intake/generator-lead' : '/v1/intake/size',
      body: {
        sqft: Number(data?.sqft || 0),
        load_watts: Number(data?.load_watts ?? data?.totalLoadWatts ?? 0),
        coverage: generatorCoverage(data?.coverage),
        name: String(data?.name || ''),
        phone: String(data?.phone || '')
      }
    };
  }

  if (type === 'maintenance_request' || type === 'maintenance_booking' || type === 'maintenance') {
    return {
      type: 'maintenance_request',
      path: '/v1/intake/maintenance',
      body: {
        service_key: String(
          data?.service_key
          || data?.serviceKey
          || MAINTENANCE_SERVICE_KEYS[data?.serviceCode]
          || ''
        ),
        name: String(data?.name || ''),
        phone: String(data?.phone || ''),
        model: String(data?.model || data?.generatorModel || '') || null,
        address: String(data?.address || '') || null
      }
    };
  }

  if (type === 'quote_request') {
    throw new Error('quote_request submissions are not supported by runtime intake');
  }
  throw new Error(`Unsupported Mini App submission type: ${type || '(missing)'}`);
}

export class MiniAppForwardError extends Error {
  constructor(message, status = 502, code = 'UPSTREAM_FAILURE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function publicRuntimeReceipt(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};

  const receipt = {};
  const allowedFields = ['id', 'request_id', 'receipt_id', 'approval_id', 'status'];
  const sources = [result, result.receipt];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of allowedFields) {
      const value = source[key];
      if (
        receipt[key] === undefined
        && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      ) {
        receipt[key] = value;
      }
    }
  }
  return receipt;
}

export async function forwardMiniAppSubmission(data, context = {}) {
  const {
    runtime,
    initData = '',
    requestId = '',
    signal,
    fetchImpl = fetch
  } = context;

  let normalized;
  try {
    normalized = normalizeMiniAppSubmission(data);
  } catch (error) {
    throw new MiniAppForwardError(error.message, 400, 'INVALID_SUBMISSION');
  }

  const baseUrl = String(runtime?.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new MiniAppForwardError('Backend not configured', 503, 'MISCONFIGURED');
  }

  const timeoutMs = Math.floor(Number(runtime?.timeoutMs ?? 10000));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
    throw new MiniAppForwardError('Backend timeout is misconfigured', 503, 'MISCONFIGURED');
  }

  const controller = new AbortController();
  let abortSource = '';
  const abortFromCaller = () => {
    if (controller.signal.aborted) return;
    abortSource = 'caller';
    controller.abort();
  };
  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeoutId = setTimeout(() => {
    if (controller.signal.aborted) return;
    abortSource = 'timeout';
    controller.abort();
  }, timeoutMs);

  const headers = { 'Content-Type': 'application/json' };
  const normalizedInitData = String(initData || '').trim();
  const token = String(runtime?.token || '').trim();
  if (normalizedInitData) headers['X-Telegram-Init-Data'] = normalizedInitData;
  if (requestId) headers['X-Request-Id'] = String(requestId);
  if (token) headers['X-Phoenix-Token'] = token;

  try {
    const upstream = await fetchImpl(`${baseUrl}${normalized.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(normalized.body),
      signal: controller.signal
    });
    if (!upstream.ok) {
      logger.error('MiniApp submit: runtime rejected', {
        status: upstream.status,
        requestId
      });
      const status = upstream.status >= 400 && upstream.status < 500
        ? upstream.status
        : 502;
      throw new MiniAppForwardError(
        status === 502 ? 'Backend rejected submission' : 'Submission rejected',
        status
      );
    }

    let result;
    try {
      result = await upstream.json();
    } catch {
      throw new MiniAppForwardError('Backend returned an invalid response');
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new MiniAppForwardError('Backend returned an invalid response');
    }
    return { normalized, result };
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (abortSource === 'caller') {
        throw new MiniAppForwardError('Client disconnected', 499, 'CLIENT_ABORTED');
      }
      throw new MiniAppForwardError('Backend timeout', 502, 'UPSTREAM_TIMEOUT');
    }
    if (error instanceof MiniAppForwardError) throw error;
    throw new MiniAppForwardError('Backend unreachable');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function registerMiniAppRoutes(app, deps = {}) {
  const {
    handleMessage,
    pluginManager,
    persistence,
    runtime,
    fetchImpl = fetch
  } = deps;
  const currentRuntime = () => (typeof runtime === 'function' ? runtime() : runtime);

  app.post('/api/miniapp/submit', async (req, res) => {
    try {
      const data = req.body;
      logger.info('MiniApp submission received', {
        type: data?.type,
        requestId: req.requestId
      });

      const disconnectController = new AbortController();
      const abortOnDisconnect = () => {
        if (!res.writableEnded) disconnectController.abort();
      };
      req.once('aborted', abortOnDisconnect);
      res.once('close', abortOnDisconnect);

      let forwarded;
      try {
        forwarded = await forwardMiniAppSubmission(data, {
          runtime: currentRuntime(),
          initData: req.get('X-Telegram-Init-Data') || '',
          requestId: req.requestId,
          signal: disconnectController.signal,
          fetchImpl
        });
      } catch (error) {
        if (error.code === 'CLIENT_ABORTED' || req.aborted || res.destroyed) return;
        logger.error('MiniApp submit failed', {
          error: error.message,
          requestId: req.requestId
        });
        return res.status(error.status || 502).json({
          success: false,
          error: error.message,
          requestId: req.requestId
        });
      } finally {
        req.removeListener('aborted', abortOnDisconnect);
        res.removeListener('close', abortOnDisconnect);
      }

      const receipt = publicRuntimeReceipt(forwarded.result);
      if (req.aborted || res.destroyed) return;
      res.json({
        success: true,
        data: {
          received: true,
          type: forwarded.normalized.type,
          ...(Object.keys(receipt).length > 0 ? { receipt } : {})
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
