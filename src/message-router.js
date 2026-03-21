/**
 * Phoenix Echo Bot - Unified Message Router
 *
 * Normalizes inbound messages from ANY platform into a common format,
 * routes them through Echo (agent.js), and formats output per-platform.
 */

import { randomUUID } from 'crypto';
import { getDefaultLogger } from './logger.js';

/** @typedef {import('./types.js').NormalizedMessage} NormalizedMessage */
/** @typedef {import('./types.js').PlatformAdapter} PlatformAdapter */
/** @typedef {import('./types.js').EchoContext} EchoContext */

const logger = getDefaultLogger().child({ component: 'message-router' });

/**
 * @typedef {Object} MessageRouterOptions
 * @property {Map<string, PlatformAdapter>} adapters - Platform adapters keyed by platform name
 * @property {Function} handleMessage - Core message handler (sessionId, text, context) => Promise<string>
 * @property {Function} [pluginRouter] - Plugin router (msg, context) => Promise<string|null>
 * @property {Function} [buildContext] - Context builder (msg) => Promise<EchoContext>
 */

export class MessageRouter {
  /**
   * @param {MessageRouterOptions} options
   */
  constructor(options = {}) {
    /** @type {Map<string, PlatformAdapter>} */
    this.adapters = options.adapters || new Map();
    this.handleMessage = options.handleMessage || null;
    this.pluginRouter = options.pluginRouter || null;
    this.buildContext = options.buildContext || null;
    this._initialized = false;
  }

  /**
   * Register a platform adapter
   * @param {string} platform - Platform name
   * @param {PlatformAdapter} adapter - Adapter instance
   */
  registerAdapter(platform, adapter) {
    this.adapters.set(platform, adapter);
    logger.info('Adapter registered', { platform });
  }

  /**
   * Initialize all registered adapters
   * @returns {Promise<void>}
   */
  async init() {
    const results = [];
    for (const [platform, adapter] of this.adapters) {
      try {
        // Wire up the adapter's onMessage to route through this router
        adapter.onMessage = async (normalizedMsg) => {
          return this.routeInbound(normalizedMsg);
        };
        await adapter.init();
        results.push({ platform, status: 'ok' });
      } catch (error) {
        logger.error('Failed to initialize adapter', { platform, error: error.message });
        results.push({ platform, status: 'error', error: error.message });
      }
    }
    this._initialized = true;
    logger.info('Message router initialized', { adapters: results });
  }

  /**
   * Route an inbound normalized message through the processing pipeline
   * @param {NormalizedMessage} msg - Normalized inbound message
   * @returns {Promise<string>} Response text
   */
  async routeInbound(msg) {
    const requestId = msg.id || randomUUID();
    const platform = msg.platform || 'unknown';

    logger.info('Routing inbound message', {
      requestId,
      platform,
      userId: msg.userId,
      channelId: msg.channelId,
      preview: (msg.text || '').substring(0, 80)
    });

    try {
      // Build context for this message
      const context = this.buildContext
        ? await this.buildContext(msg)
        : {
            sessionId: `${platform}-${msg.channelId || msg.userId}`,
            userId: msg.userId,
            platform,
            userMemory: {},
            channelState: {},
            requestId
          };

      // Try plugin routing first
      if (this.pluginRouter) {
        const pluginResponse = await this.pluginRouter(msg, context);
        if (pluginResponse !== null && pluginResponse !== undefined) {
          logger.info('Message handled by plugin', { requestId, platform });
          return this.formatOutbound(pluginResponse, platform);
        }
      }

      // Fall through to core Echo agent
      if (this.handleMessage) {
        const response = await this.handleMessage(context.sessionId, msg.text, {
          requestId,
          channel: platform,
          userId: msg.userId,
          userName: msg.userName
        });
        return this.formatOutbound(response, platform);
      }

      logger.warn('No message handler configured', { requestId });
      return 'I received your message but no handler is configured.';
    } catch (error) {
      logger.error('Error routing inbound message', {
        requestId,
        platform,
        error: error.message
      });
      return this.formatOutbound(
        'Sorry, I encountered an error processing your message. Please try again.',
        platform
      );
    }
  }

  /**
   * Normalize a raw platform message using the appropriate adapter
   * @param {string} platform - Platform name
   * @param {Object} raw - Raw platform message
   * @returns {NormalizedMessage}
   */
  normalize(platform, raw) {
    const adapter = this.adapters.get(platform);
    if (adapter) {
      return adapter.normalizeInbound(raw);
    }

    // Fallback normalization for unknown platforms
    return {
      id: randomUUID(),
      platform,
      channelId: raw.channelId || '',
      userId: raw.userId || '',
      userName: raw.userName || '',
      text: raw.text || raw.message || raw.content || '',
      attachments: [],
      metadata: raw,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format outbound response text for a specific platform
   * @param {string} text - Raw response text
   * @param {string} platform - Target platform
   * @returns {string} Formatted text
   */
  formatOutbound(text, platform) {
    const adapter = this.adapters.get(platform);
    if (adapter) {
      return adapter.formatResponse(text);
    }
    return String(text || '');
  }

  /**
   * Send a message to a specific platform and channel
   * @param {string} platform - Platform name
   * @param {string} channelId - Channel identifier
   * @param {string} text - Message text
   * @param {Object} [options] - Platform-specific options
   * @returns {Promise<void>}
   */
  async sendMessage(platform, channelId, text, options = {}) {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`No adapter registered for platform: ${platform}`);
    }
    if (!adapter.isReady()) {
      throw new Error(`Adapter not ready: ${platform}`);
    }

    const formatted = adapter.formatResponse(text);
    await adapter.sendMessage(channelId, formatted, options);
  }

  /**
   * Get status of all adapters
   * @returns {Object}
   */
  getStatus() {
    const status = {};
    for (const [platform, adapter] of this.adapters) {
      status[platform] = {
        ready: adapter.isReady(),
        info: adapter.getInfo ? adapter.getInfo() : null
      };
    }
    return status;
  }

  /**
   * Gracefully shut down all adapters and clean up
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.info('Message router shutting down');
    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.shutdown();
        logger.info('Adapter shut down', { platform });
      } catch (error) {
        logger.error('Error shutting down adapter', { platform, error: error.message });
      }
    }
    this.adapters.clear();
    this._initialized = false;
  }
}

/**
 * Cleanup export (module contract)
 * @param {MessageRouter} router - Router instance to clean up
 * @returns {Promise<void>}
 */
export async function cleanup(router) {
  if (router) {
    await router.cleanup();
  }
}

export default MessageRouter;
