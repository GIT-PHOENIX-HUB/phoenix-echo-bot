/**
 * Phoenix Echo Gateway - Telegram Channel Adapter
 *
 * Uses Telegram Bot API via long polling.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TelegramBot = require('node-telegram-bot-api');
import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger();

export class TelegramChannel {
  constructor(config = {}) {
    this.config = config;
    this.bot = null;
    this.messageHandler = null;
    this.ready = false;
    this.botInfo = null;
    this.listenersBound = false;

    const botToken = String(config.botToken || '').trim();
    if (!botToken) {
      throw new Error('Telegram channel requires botToken');
    }

    const pollIntervalMs = Number(config.pollIntervalMs || 300);

    this.bot = new TelegramBot(botToken, {
      polling: {
        autoStart: false,
        interval: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 300,
        params: {
          timeout: 30
        }
      }
    });

    logger.info('TelegramChannel initialized', {
      pollIntervalMs: this.bot.options?.polling?.interval || 300
    });
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  bindListeners() {
    if (this.listenersBound) {
      return;
    }
    this.listenersBound = true;

    // Prevent unhandled Telegram client errors from crashing the gateway.
    this.bot.on('error', (error) => {
      logger.error('Telegram client error', {
        message: error?.message || 'telegram error',
        code: error?.code || null
      });
    });

    this.bot.on('webhook_error', (error) => {
      logger.error('Telegram webhook error', {
        message: error?.message || 'webhook error',
        code: error?.code || null
      });
    });

    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error', {
        message: error?.message || 'polling error',
        code: error?.code || null
      });
    });

    this.bot.on('message', async (message) => {
      try {
        const text = String(message?.text || message?.caption || '').trim();
        if (!text) {
          return;
        }

        const chatId = message?.chat?.id;
        const from = message?.from || {};
        logger.info('Telegram message received', {
          chatId,
          fromId: from.id || null,
          username: from.username || null
        });

        if (!this.messageHandler) {
          return;
        }

        await this.messageHandler({
          id: message.message_id,
          chatId: String(chatId),
          fromId: String(from.id || ''),
          fromName: from.first_name || from.username || String(from.id || 'unknown'),
          text,
          timestamp: message.date || null,
          reply: async (responseText) => {
            await this.bot.sendMessage(chatId, String(responseText), {
              reply_to_message_id: message.message_id
            });
          }
        });
      } catch (error) {
        logger.error('Error handling Telegram message', {
          error: error.message,
          stack: error.stack
        });
      }
    });
  }

  async start() {
    this.bindListeners();
    await this.bot.startPolling();
    this.botInfo = await this.bot.getMe();
    this.ready = true;
    logger.info('Telegram client ready', {
      botId: this.botInfo?.id || null,
      username: this.botInfo?.username || null
    });
  }

  async stop() {
    if (!this.bot) {
      return;
    }
    try {
      await this.bot.stopPolling();
    } catch (error) {
      logger.warn('Telegram stopPolling warning', { message: error.message });
    }
    this.ready = false;
  }

  async sendMessage(to, text) {
    if (!this.ready) {
      throw new Error('Telegram client not ready');
    }

    const raw = String(to || '').trim();
    if (!raw) {
      throw new Error('Telegram target chat id is required');
    }

    const chatId = /^-?\d+$/.test(raw) ? Number(raw) : raw;
    const sent = await this.bot.sendMessage(chatId, String(text || ''));
    logger.info('Telegram message sent', {
      chatId: String(chatId),
      messageId: sent?.message_id || null
    });
    return {
      id: sent?.message_id || null,
      chatId: String(chatId),
      timestamp: sent?.date || null
    };
  }

  isReady() {
    return this.ready;
  }

  getInfo() {
    return {
      ready: this.ready,
      botId: this.botInfo?.id || null,
      username: this.botInfo?.username || null
    };
  }
}

export async function createTelegramChannel(config, messageHandler) {
  const channel = new TelegramChannel(config);
  if (messageHandler) {
    channel.onMessage(messageHandler);
  }
  await channel.start();
  return channel;
}
