/**
 * Phoenix Echo Bot - WhatsApp Adapter
 *
 * Uses whatsapp-web.js for messaging. Supports template messages, media,
 * and business profile integration.
 */

import { randomUUID } from 'crypto';
import { BaseAdapter } from './base-adapter.js';

/** @typedef {import('../types.js').NormalizedMessage} NormalizedMessage */

export class WhatsAppAdapter extends BaseAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.config - WhatsApp configuration
   * @param {string} [options.config.sessionDir] - Session data directory
   * @param {Function} [options.onMessage] - Inbound message callback
   */
  constructor(options = {}) {
    super({ ...options, platform: 'whatsapp' });
    this.sessionDir = this.config.sessionDir || '';
    this.client = null;
    this._ready = false;
  }

  /** @returns {Promise<void>} */
  async init() {
    try {
      const { Client, LocalAuth } = await import('whatsapp-web.js');

      const authStrategy = this.sessionDir
        ? new LocalAuth({ dataPath: this.sessionDir })
        : new LocalAuth();

      this.client = new Client({
        authStrategy,
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      });

      this.client.on('ready', () => {
        this._ready = true;
        this.logger.info('WhatsApp client ready');
      });

      this.client.on('qr', (qr) => {
        this.logger.info('WhatsApp QR code received -- scan to authenticate');
        // TODO(gateway): Display QR code in terminal or expose via API
        try {
          import('qrcode-terminal').then((mod) => {
            const qrcode = mod.default || mod;
            qrcode.generate(qr, { small: true });
          });
        } catch {
          // qrcode-terminal is optional
        }
      });

      this.client.on('message', async (msg) => {
        try {
          // Skip status broadcasts
          if (msg.from === 'status@broadcast') return;

          const normalized = this.normalizeInbound(msg);
          if (this.onMessage && normalized.text) {
            const response = await this.onMessage(normalized);
            if (response) {
              await msg.reply(this.formatResponse(response));
            }
          }
        } catch (error) {
          this.logger.error('Error handling WhatsApp message', { error: error.message });
        }
      });

      this.client.on('disconnected', (reason) => {
        this._ready = false;
        this.logger.warn('WhatsApp client disconnected', { reason });
      });

      this.client.on('auth_failure', (msg) => {
        this.logger.error('WhatsApp authentication failure', { message: msg });
      });

      await this.client.initialize();
      await super.init();
      this.logger.info('WhatsApp adapter initialized');
    } catch (error) {
      this.logger.error('Failed to initialize WhatsApp adapter', { error: error.message });
      throw error;
    }
  }

  /** @returns {Promise<void>} */
  async shutdown() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (error) {
        this.logger.warn('Error destroying WhatsApp client', { error: error.message });
      }
      this.client = null;
      this._ready = false;
    }
    await super.shutdown();
  }

  /** @returns {boolean} */
  isReady() {
    return this._ready && this._initialized;
  }

  /**
   * Send a message to a WhatsApp chat
   * @param {string} channelId - Chat ID (e.g. "15551234567@c.us")
   * @param {string} text - Message text
   * @param {Object} [options] - Options (media, templateName, etc.)
   * @returns {Promise<void>}
   */
  async sendMessage(channelId, text, options = {}) {
    if (!this.client || !this._ready) {
      throw new Error('WhatsApp adapter not ready');
    }

    const formatted = this.formatResponse(text);

    if (options.media) {
      // TODO(gateway): Implement media message sending via MessageMedia
      this.logger.warn('WhatsApp media sending not yet implemented');
    }

    if (options.templateName) {
      // TODO(gateway): Implement template message sending via WhatsApp Business API
      this.logger.warn('WhatsApp template messages not yet implemented');
    }

    await this.client.sendMessage(channelId, formatted);
  }

  /**
   * Format response for WhatsApp (plain text with limited formatting)
   * @param {string} text - Raw text
   * @returns {string}
   */
  formatResponse(text) {
    let formatted = String(text || '');

    // WhatsApp uses its own formatting:
    // *bold*, _italic_, ~strikethrough~, ```monospace```
    // Convert standard markdown bold ** -> *
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '*$1*');

    return formatted;
  }

  /**
   * Normalize a WhatsApp message into NormalizedMessage
   * @param {Object} msg - whatsapp-web.js message
   * @returns {NormalizedMessage}
   */
  normalizeInbound(msg) {
    const attachments = [];
    if (msg.hasMedia) {
      attachments.push({
        type: msg.type || 'media',
        url: '',
        name: msg.type || 'attachment'
      });
    }

    const contact = msg._data?.notifyName || '';
    const from = msg.from || '';
    const chatId = msg.from || '';

    return {
      id: msg.id?._serialized || randomUUID(),
      platform: 'whatsapp',
      channelId: chatId,
      userId: from,
      userName: contact,
      text: msg.body || '',
      attachments,
      metadata: {
        isGroupMsg: msg.isGroupMsg || false,
        hasMedia: msg.hasMedia || false,
        type: msg.type,
        fromMe: msg.fromMe || false
      },
      timestamp: msg.timestamp
        ? new Date(msg.timestamp * 1000).toISOString()
        : new Date().toISOString()
    };
  }

  /**
   * Get info about the connected WhatsApp account
   * @returns {Object|null}
   */
  getInfo() {
    if (!this.client || !this._ready) return null;
    const info = this.client.info;
    return info ? {
      pushname: info.pushname,
      wid: info.wid?._serialized,
      platform: info.platform
    } : null;
  }
}

export default WhatsAppAdapter;
