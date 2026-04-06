/**
 * Phoenix Echo Gateway - Mini App Routes
 *
 * REST API endpoints for the Telegram Mini App (phoenix-electric-miniapp).
 */

import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger();

export function registerMiniAppRoutes(app, deps = {}) {
  const { handleMessage, pluginManager, persistence } = deps;

  app.post('/api/miniapp/submit', async (req, res) => {
    try {
      const data = req.body;
      logger.info('MiniApp submission received', {
        type: data?.type,
        requestId: req.requestId
      });
      res.json({
        success: true,
        data: { received: true, type: data?.type },
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('MiniApp submit error', { error: error.message });
      res.status(500).json({ success: false, error: 'Internal server error', requestId: req.requestId });
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
