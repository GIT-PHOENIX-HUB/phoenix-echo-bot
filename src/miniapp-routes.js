/**
 * Phoenix Echo Bot - MiniApp Backend Routes
 *
 * API routes for the Telegram MiniApp including service requests,
 * Echo AI chat, product catalog, NEC code lookup, job status, and more.
 */

import { randomUUID } from 'crypto';
import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger().child({ component: 'miniapp-routes' });

/** @typedef {import('./types.js').MiniAppSubmission} MiniAppSubmission */

/**
 * Validate a MiniApp submission
 * @param {Object} body - Request body
 * @returns {{valid:boolean, errors:string[]}}
 */
function validateSubmission(body) {
  const errors = [];

  if (!body.type) {
    errors.push('type is required (service_request|generator_lead|maintenance_booking|quote_request)');
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
    errors.push('name is required (minimum 2 characters)');
  }
  if (!body.phone && !body.email) {
    errors.push('At least one of phone or email is required');
  }
  if (body.phone && !/^\+?[\d\s()-]{7,20}$/.test(body.phone)) {
    errors.push('Invalid phone number format');
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push('Invalid email format');
  }
  if (!body.description || typeof body.description !== 'string' || body.description.trim().length < 10) {
    errors.push('description is required (minimum 10 characters)');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Register MiniApp routes on an Express app
 * @param {import('express').Express} app - Express app
 * @param {Object} deps - Dependencies
 * @param {Function} deps.handleMessage - Core message handler
 * @param {import('./plugins/plugin-manager.js').PluginManager} deps.pluginManager - Plugin manager
 * @param {import('./echo-persistence.js').EchoPersistence} deps.persistence - Persistence layer
 */
export function registerMiniAppRoutes(app, deps = {}) {
  const { handleMessage, pluginManager, persistence } = deps;

  /**
   * POST /api/miniapp/submit
   * Handle service requests, generator leads, maintenance bookings
   */
  app.post('/api/miniapp/submit', async (req, res) => {
    const requestId = req.requestId || randomUUID();

    try {
      const validation = validateSubmission(req.body);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.errors,
          requestId
        });
      }

      /** @type {MiniAppSubmission} */
      const submission = {
        type: req.body.type,
        name: req.body.name.trim(),
        phone: req.body.phone || '',
        email: req.body.email || '',
        address: req.body.address || '',
        description: req.body.description.trim(),
        preferredDate: req.body.preferredDate || null,
        urgency: req.body.urgency || 'routine',
        metadata: req.body.metadata || {}
      };

      // TODO(gateway): Forward submission to ServiceFusion CRM
      // TODO(gateway): Send notification to dispatch via Teams/Telegram

      logger.info('MiniApp submission received', {
        requestId,
        type: submission.type,
        name: submission.name,
        urgency: submission.urgency
      });

      res.status(201).json({
        success: true,
        submissionId: randomUUID(),
        message: 'Your request has been received. Phoenix Electric will contact you shortly.',
        submission,
        requestId
      });
    } catch (error) {
      logger.error('MiniApp submission error', { requestId, error: error.message });
      res.status(500).json({ error: 'Failed to process submission', requestId });
    }
  });

  /**
   * POST /api/miniapp/chat
   * Echo AI chat for MiniApp users
   */
  app.post('/api/miniapp/chat', async (req, res) => {
    const requestId = req.requestId || randomUUID();

    try {
      const { message, userId } = req.body || {};
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required', requestId });
      }

      const safeUserId = String(userId || 'miniapp-anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
      const sessionId = `miniapp-${safeUserId}`;

      if (!handleMessage) {
        return res.status(503).json({
          error: 'Chat service not available',
          requestId
        });
      }

      const response = await handleMessage(sessionId, message.trim(), {
        requestId,
        channel: 'miniapp',
        userId: safeUserId
      });

      res.json({ response, sessionId, requestId });
    } catch (error) {
      logger.error('MiniApp chat error', { requestId, error: error.message });
      res.status(500).json({ error: 'Chat processing failed', requestId });
    }
  });

  /**
   * GET /api/miniapp/products
   * Rexel product catalog for MiniApp
   */
  app.get('/api/miniapp/products', async (req, res) => {
    const requestId = req.requestId || randomUUID();

    try {
      // Dynamic import to avoid circular dependency
      const { searchProducts, CATALOG_CATEGORIES, SAMPLE_PRODUCTS } = await import('./plugins/rexel.js');

      const query = String(req.query.q || '').trim();
      const category = String(req.query.category || '').trim();

      if (query) {
        const results = searchProducts(query);
        return res.json({ products: results, query, requestId });
      }

      if (category) {
        const cat = CATALOG_CATEGORIES[category];
        if (!cat) {
          return res.status(404).json({ error: `Unknown category: ${category}`, requestId });
        }
        const products = SAMPLE_PRODUCTS.filter((p) => p.category === category);
        return res.json({ category: cat, products, requestId });
      }

      // Return categories overview
      res.json({ categories: CATALOG_CATEGORIES, requestId });
    } catch (error) {
      logger.error('MiniApp products error', { requestId, error: error.message });
      res.status(500).json({ error: 'Failed to load products', requestId });
    }
  });

  /**
   * GET /api/miniapp/nec/:section
   * NEC code lookup
   */
  app.get('/api/miniapp/nec/:section', async (req, res) => {
    const requestId = req.requestId || randomUUID();

    try {
      const { NEC_ARTICLES } = await import('./plugins/electrical-guru.js');

      const section = String(req.params.section || '').trim();
      const article = NEC_ARTICLES[section];

      if (!article) {
        const available = Object.keys(NEC_ARTICLES).join(', ');
        return res.status(404).json({
          error: `NEC article ${section} not found`,
          available,
          requestId
        });
      }

      res.json({
        article: section,
        title: article.title,
        summary: article.summary,
        note: 'Always verify with the full NEC 2023 codebook and your local AHJ.',
        requestId
      });
    } catch (error) {
      logger.error('MiniApp NEC lookup error', { requestId, error: error.message });
      res.status(500).json({ error: 'Failed to look up NEC section', requestId });
    }
  });

  /**
   * GET /api/miniapp/job-status/:id
   * Job status tracking
   */
  app.get('/api/miniapp/job-status/:id', async (req, res) => {
    const requestId = req.requestId || randomUUID();

    try {
      const jobId = String(req.params.id || '').trim();
      if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required', requestId });
      }

      // TODO(gateway): Look up actual job status from ServiceFusion API
      res.json({
        jobId,
        status: 'pending',
        message: 'Job status tracking requires ServiceFusion API connection. Configure SERVICEFUSION_API_KEY to enable.',
        requestId
      });
    } catch (error) {
      logger.error('MiniApp job status error', { requestId, error: error.message });
      res.status(500).json({ error: 'Failed to check job status', requestId });
    }
  });

  /**
   * GET /api/miniapp/service-history
   * Customer service history
   */
  app.get('/api/miniapp/service-history', async (req, res) => {
    const requestId = req.requestId || randomUUID();

    try {
      const userId = String(req.query.userId || '').trim();
      if (!userId) {
        return res.status(400).json({ error: 'userId query parameter is required', requestId });
      }

      // TODO(gateway): Look up service history from ServiceFusion API
      res.json({
        userId,
        history: [],
        message: 'Service history requires ServiceFusion API connection.',
        requestId
      });
    } catch (error) {
      logger.error('MiniApp service history error', { requestId, error: error.message });
      res.status(500).json({ error: 'Failed to load service history', requestId });
    }
  });

  /**
   * POST /api/miniapp/quote-request
   * Quote submission
   */
  app.post('/api/miniapp/quote-request', async (req, res) => {
    const requestId = req.requestId || randomUUID();

    try {
      const { name, email, phone, description, address, preferredDate } = req.body || {};

      if (!name || !description) {
        return res.status(400).json({
          error: 'name and description are required',
          requestId
        });
      }
      if (!email && !phone) {
        return res.status(400).json({
          error: 'At least one of email or phone is required',
          requestId
        });
      }

      const quoteRequest = {
        id: randomUUID(),
        name: String(name).trim(),
        email: email || '',
        phone: phone || '',
        description: String(description).trim(),
        address: address || '',
        preferredDate: preferredDate || null,
        submittedAt: new Date().toISOString()
      };

      // TODO(gateway): Forward quote request to ServiceFusion as an estimate
      // TODO(gateway): Notify sales team via Teams/email

      logger.info('Quote request received', {
        requestId,
        quoteId: quoteRequest.id,
        name: quoteRequest.name
      });

      res.status(201).json({
        success: true,
        quoteId: quoteRequest.id,
        message: 'Your quote request has been submitted. A Phoenix Electric representative will follow up within 24 hours.',
        requestId
      });
    } catch (error) {
      logger.error('MiniApp quote request error', { requestId, error: error.message });
      res.status(500).json({ error: 'Failed to submit quote request', requestId });
    }
  });

  logger.info('MiniApp routes registered');
}

export default { registerMiniAppRoutes };
