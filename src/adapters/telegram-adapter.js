/**
 * Phoenix Echo Bot - Telegram Adapter
 *
 * Uses node-telegram-bot-api for message handling, inline keyboards for
 * interactive responses, and MiniApp web_app button integration.
 */

import { randomUUID } from 'crypto';
import { BaseAdapter } from './base-adapter.js';

/** @typedef {import('../types.js').NormalizedMessage} NormalizedMessage */

export class TelegramAdapter extends BaseAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.config - Telegram configuration
   * @param {string} options.config.botToken - Telegram Bot API token
   * @param {string} [options.config.miniappUrl] - MiniApp URL for web_app buttons
   * @param {number} [options.config.pollIntervalMs=300] - Polling interval
   * @param {Function} [options.onMessage] - Inbound message callback
   */
  constructor(options = {}) {
    super({ ...options, platform: 'telegram' });
    this.botToken = this.config.botToken || '';
    this.miniappUrl = this.config.miniappUrl || '';
    this.pollIntervalMs = this.config.pollIntervalMs || 300;
    this.bot = null;
  }

  /** @returns {Promise<void>} */
  async init() {
    if (!this.botToken) {
      this.logger.warn('Telegram adapter disabled: missing botToken');
      return;
    }

    try {
      const TelegramBot = (await import('node-telegram-bot-api')).default;

      this.bot = new TelegramBot(this.botToken, {
        polling: {
          interval: this.pollIntervalMs,
          autoStart: true
        }
      });

      this.bot.on('message', async (msg) => {
        try {
          const normalized = this.normalizeInbound(msg);
          if (this.onMessage && normalized.text) {
            const response = await this.onMessage(normalized);
            if (response) {
              await this.sendMessage(String(msg.chat.id), response);
            }
          }
        } catch (error) {
          this.logger.error('Error handling Telegram message', { error: error.message });
        }
      });

      this.bot.on('callback_query', async (query) => {
        try {
          const normalized = this._normalizeCallbackQuery(query);
          if (this.onMessage) {
            const response = await this.onMessage(normalized);
            if (response) {
              await this.sendMessage(String(query.message.chat.id), response);
            }
          }
          // Acknowledge the callback
          await this.bot.answerCallbackQuery(query.id);
        } catch (error) {
          this.logger.error('Error handling callback query', { error: error.message });
        }
      });

      this.bot.on('polling_error', (error) => {
        this.logger.error('Telegram polling error', { error: error.message });
      });

      await super.init();
      this.logger.info('Telegram adapter initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Telegram adapter', { error: error.message });
      throw error;
    }
  }

  /** @returns {Promise<void>} */
  async shutdown() {
    if (this.bot) {
      try {
        await this.bot.stopPolling();
      } catch (error) {
        this.logger.warn('Error stopping Telegram polling', { error: error.message });
      }
      this.bot = null;
    }
    await super.shutdown();
  }

  /**
   * Send a message to a Telegram chat
   * @param {string} channelId - Chat ID
   * @param {string} text - Message text (HTML supported)
   * @param {Object} [options] - Options (inlineKeyboard, webAppButton, etc.)
   * @returns {Promise<void>}
   */
  async sendMessage(channelId, text, options = {}) {
    if (!this.bot) {
      throw new Error('Telegram adapter not initialized');
    }

    const sendOptions = {
      parse_mode: 'HTML',
      disable_web_page_preview: options.disableLinkPreview !== false
    };

    if (options.inlineKeyboard) {
      sendOptions.reply_markup = {
        inline_keyboard: options.inlineKeyboard
      };
    }

    if (options.webAppButton && this.miniappUrl) {
      sendOptions.reply_markup = {
        inline_keyboard: [[{
          text: options.webAppButton.text || 'Open MiniApp',
          web_app: { url: this.miniappUrl }
        }]]
      };
    }

    const formatted = this.formatResponse(text);
    await this.bot.sendMessage(channelId, formatted, sendOptions);
  }

  /**
   * Format response text for Telegram HTML rendering
   * @param {string} text - Raw text (may contain markdown)
   * @returns {string} HTML-formatted text
   */
  formatResponse(text) {
    let formatted = String(text || '');

    // Convert markdown bold to HTML bold
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    // Convert markdown italic to HTML italic
    formatted = formatted.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
    // Convert markdown code blocks
    formatted = formatted.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre>$2</pre>');
    // Convert inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    return formatted;
  }

  /**
   * Normalize a Telegram message into NormalizedMessage
   * @param {Object} msg - Telegram message object
   * @returns {NormalizedMessage}
   */
  normalizeInbound(msg) {
    const attachments = [];
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      attachments.push({ type: 'photo', url: largest.file_id, name: 'photo' });
    }
    if (msg.document) {
      attachments.push({
        type: msg.document.mime_type || 'document',
        url: msg.document.file_id,
        name: msg.document.file_name || 'document'
      });
    }

    return {
      id: String(msg.message_id || randomUUID()),
      platform: 'telegram',
      channelId: String(msg.chat?.id || ''),
      userId: String(msg.from?.id || ''),
      userName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || '',
      text: msg.text || msg.caption || '',
      attachments,
      metadata: {
        chatType: msg.chat?.type,
        chatTitle: msg.chat?.title,
        isBot: msg.from?.is_bot,
        replyToMessageId: msg.reply_to_message?.message_id
      },
      timestamp: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString()
    };
  }

  /**
   * Normalize a callback query into NormalizedMessage
   * @param {Object} query - Telegram callback query
   * @returns {NormalizedMessage}
   */
  _normalizeCallbackQuery(query) {
    return {
      id: String(query.id || randomUUID()),
      platform: 'telegram',
      channelId: String(query.message?.chat?.id || ''),
      userId: String(query.from?.id || ''),
      userName: [query.from?.first_name, query.from?.last_name].filter(Boolean).join(' ') || '',
      text: query.data || '',
      attachments: [],
      metadata: {
        isCallbackQuery: true,
        callbackQueryId: query.id,
        originalMessageId: query.message?.message_id
      },
      timestamp: new Date().toISOString()
    };
  }
}

export default TelegramAdapter;
