/**
 * Phoenix Echo Bot - Base Platform Adapter
 *
 * Abstract base class that defines the common interface every platform adapter
 * must implement. Concrete adapters (Teams, Telegram, WhatsApp, Email) extend
 * this and override the lifecycle and messaging hooks.
 */

import { randomUUID } from 'crypto';
import { getDefaultLogger } from '../logger.js';

/** @typedef {import('../types.js').NormalizedMessage} NormalizedMessage */
/** @typedef {import('../types.js').PlatformAdapter} PlatformAdapter */

export class BaseAdapter {
  /**
   * @param {Object} options
   * @param {string} options.platform - Platform identifier (teams|telegram|whatsapp|email)
   * @param {Object} [options.config] - Platform-specific configuration
   * @param {Function} [options.onMessage] - Callback when an inbound message is received
   */
  constructor(options = {}) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly');
    }
    this.platform = options.platform || 'unknown';
    this.config = options.config || {};
    this.onMessage = options.onMessage || null;
    this.logger = getDefaultLogger().child({ component: `adapter-${this.platform}` });
    this._initialized = false;
  }

  /**
   * Initialize the adapter (connect to APIs, start polling, etc.)
   * @returns {Promise<void>}
   */
  async init() {
    this.logger.info('Adapter initialized', { platform: this.platform });
    this._initialized = true;
  }

  /**
   * Gracefully shut down the adapter
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info('Adapter shutting down', { platform: this.platform });
    this._initialized = false;
  }

  /**
   * Send a message to a specific channel/user on this platform
   * @param {string} channelId - Platform-specific channel or chat identifier
   * @param {string} text - Message text to send
   * @param {Object} [options] - Platform-specific send options (buttons, cards, etc.)
   * @returns {Promise<void>}
   */
  async sendMessage(channelId, text, options = {}) {
    throw new Error(`sendMessage not implemented for ${this.platform}`);
  }

  /**
   * Format a response string for this platform's rendering
   * @param {string} text - Raw response text (may contain markdown)
   * @param {Object} [options] - Formatting options
   * @returns {string} Platform-formatted text
   */
  formatResponse(text, options = {}) {
    // Default: pass through unchanged
    return text;
  }

  /**
   * Normalize a raw inbound platform message into NormalizedMessage format
   * @param {Object} raw - Raw platform-specific message object
   * @returns {NormalizedMessage}
   */
  normalizeInbound(raw) {
    return {
      id: randomUUID(),
      platform: this.platform,
      channelId: '',
      userId: '',
      userName: '',
      text: '',
      attachments: [],
      metadata: {},
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Whether the adapter is initialized and ready
   * @returns {boolean}
   */
  isReady() {
    return this._initialized;
  }
}

export default BaseAdapter;
