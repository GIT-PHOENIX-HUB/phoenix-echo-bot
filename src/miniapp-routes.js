/**
 * Phoenix Echo Gateway - Mini App Routes
 *
 * REST API endpoints for the Telegram Mini App (phoenix-electric-miniapp).
 */

import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger();

// Mini App submission types → Phoenix runtime intake contract (owner 24_intake).
const INTAKE_PATHS = {
  'service-request': '/v1/intake/service-request',
  'size': '/v1/intake/size',
  'sizing': '/v1/intake/size',
  'generator-lead': '/v1/intake/generator-lead',
  'maintenance': '/v1/intake/maintenance'
};

export function registerMiniAppRoutes(app, deps = {}) {
  const { handleMessage, pluginManager, persistence, runtime } = deps;

  app.post('/api/miniapp/submit', async (req, res) => {
    try {
      const data = req.body;
      logger.info('MiniApp submission received', {
        type: data?.type,
        requestId: req.requestId
      });

      // Forward to the Phoenix runtime's intake surface. The runtime validates
      // the Telegram initData HMAC itself — pass the header through untouched.
      const base = runtime?.baseUrl;
      if (!base) {
        logger.error('MiniApp submit: no runtime.baseUrl configured — refusing to swallow submission');
        return res.status(503).json({ success: false, error: 'Backend not configured', requestId: req.requestId });
      }
      const intakePath = INTAKE_PATHS[data?.type] || INTAKE_PATHS['service-request'];
      const upstream = await fetch(`${base}${intakePath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': req.get('X-Telegram-Init-Data') || ''
        },
        body: JSON.stringify(data)
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        logger.error('MiniApp submit: runtime rejected', { status: upstream.status, detail: detail.slice(0, 300) });
        return res.status(502).json({ success: false, error: 'Backend rejected submission', requestId: req.requestId });
      }
      const result = await upstream.json().catch(() => ({}));
      res.json({
        success: true,
        data: { received: true, type: data?.type, runtime: result },
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
