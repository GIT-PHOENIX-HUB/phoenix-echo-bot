/**
 * Phoenix Echo Gateway - WhatsApp Channel Adapter
 * 
 * Uses whatsapp-web.js for WhatsApp Web integration.
 * QR code authentication, message send/receive, session persistence.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require('whatsapp-web.js');
import qrcode from 'qrcode-terminal';
import { constants as fsConstants } from 'fs';
import { access, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger();

export class WhatsAppChannel {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
    this.ready = false;
    this.messageHandler = null;
    this.qrHandler = null;
    this.sessionDir = resolve(
      config.sessionDir || join(process.env.HOME, '.phoenix-echo', 'whatsapp-session')
    );
    const executablePath = String(
      config.executablePath || process.env.PUPPETEER_EXECUTABLE_PATH || ''
    ).trim();
    const puppeteerArgs =
      Array.isArray(config.puppeteerArgs) && config.puppeteerArgs.length > 0
        ? config.puppeteerArgs
        : ['--no-sandbox', '--disable-setuid-sandbox'];
    const puppeteer = {
      headless: typeof config.headless === 'boolean' ? config.headless : true,
      args: puppeteerArgs,
      dumpio: config.dumpio === true
    };
    if (executablePath) {
      puppeteer.executablePath = executablePath;
    }
    
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: this.sessionDir
      }),
      puppeteer
    });

    this.setupListeners();
    
    logger.info('WhatsAppChannel initialized', {
      sessionDir: this.sessionDir,
      executablePath: executablePath || null
    });
  }

  setupListeners() {
    // QR Code for authentication
    this.client.on('qr', (qr) => {
      logger.info('WhatsApp QR code generated');
      
      // Display QR in terminal
      console.log('\n🔥 WhatsApp QR Code:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nScan this QR code with WhatsApp to authenticate.\n');
      
      // Call custom QR handler if provided
      if (this.qrHandler) {
        this.qrHandler(qr);
      }
    });

    // Ready event
    this.client.on('ready', () => {
      this.ready = true;
      const info = this.client.info;
      logger.info('WhatsApp client ready', {
        phone: info.wid.user,
        platform: info.platform,
        pushname: info.pushname
      });
    });

    // Authenticated
    this.client.on('authenticated', () => {
      logger.info('WhatsApp authenticated successfully');
    });

    // Authentication failure
    this.client.on('auth_failure', (error) => {
      logger.error('WhatsApp authentication failed', {
        error: error?.message || String(error)
      });
    });

    // Disconnected
    this.client.on('disconnected', (reason) => {
      this.ready = false;
      logger.warn('WhatsApp disconnected', { reason });
    });

    // Generic client error
    this.client.on('error', (error) => {
      logger.error('WhatsApp client error', {
        error: error?.message || String(error),
        stack: error?.stack || null
      });
    });

    // Incoming messages
    this.client.on('message', async (message) => {
      try {
        // Skip if message is from self
        if (message.fromMe) {
          return;
        }

        const contact = await message.getContact();
        const chat = await message.getChat();

        logger.info('WhatsApp message received', {
          from: contact.number,
          isGroup: chat.isGroup,
          messageType: message.type,
          hasMedia: message.hasMedia
        });

        // Call message handler if registered
        if (this.messageHandler) {
          await this.messageHandler({
            id: message.id._serialized,
            from: contact.number,
            fromName: contact.pushname || contact.name || contact.number,
            chatId: chat.id._serialized,
            isGroup: chat.isGroup,
            groupName: chat.isGroup ? chat.name : null,
            body: message.body,
            type: message.type,
            timestamp: message.timestamp,
            hasMedia: message.hasMedia,
            reply: async (text) => {
              await message.reply(text);
            }
          });
        }
      } catch (error) {
        logger.error('Error handling WhatsApp message', {
          error: error.message,
          stack: error.stack
        });
      }
    });

    // Message creation (sent messages)
    this.client.on('message_create', async (message) => {
      if (!message.fromMe) return;

      try {
        const chat = await message.getChat();
        logger.info('WhatsApp message sent', {
          to: chat.id._serialized,
          isGroup: chat.isGroup,
          messageType: message.type
        });
      } catch (error) {
        logger.error('Error tracking sent message', { error: error.message });
      }
    });
  }

  /**
   * Register message handler
   * @param {Function} handler - Handler function(message)
   */
  onMessage(handler) {
    this.messageHandler = handler;
  }

  /**
   * Register QR code handler
   * @param {Function} handler - Handler function(qr)
   */
  onQR(handler) {
    this.qrHandler = handler;
  }

  /**
   * Start the WhatsApp client
   */
  async start() {
    logger.info('Starting WhatsApp client...');
    await mkdir(this.sessionDir, { recursive: true });
    await access(this.sessionDir, fsConstants.R_OK | fsConstants.W_OK);

    try {
      await this.client.initialize();
    } catch (error) {
      const message = error?.message || String(error);
      logger.error('WhatsApp client startup failed', {
        error: message,
        stack: error?.stack || null,
        sessionDir: this.sessionDir,
        hint: message.includes('Failed to launch the browser process')
          ? 'Browser launch failed. Verify runtime permissions or set channels.whatsapp.executablePath / PUPPETEER_EXECUTABLE_PATH.'
          : null
      });
      throw error;
    }
  }

  /**
   * Stop the WhatsApp client
   */
  async stop() {
    if (this.client) {
      logger.info('Stopping WhatsApp client...');
      await this.client.destroy();
      this.ready = false;
    }
  }

  /**
   * Send a message
   * @param {string} to - Phone number (e.g., '17209550284@c.us') or chat ID
   * @param {string} text - Message text
   * @returns {Promise<Object>} Sent message
   */
  async sendMessage(to, text) {
    if (!this.ready) {
      throw new Error('WhatsApp client not ready');
    }

    try {
      // Format phone number if needed
      let chatId = to;
      if (!to.includes('@')) {
        // Remove non-digits
        const number = to.replace(/\D/g, '');
        chatId = `${number}@c.us`;
      }

      const message = await this.client.sendMessage(chatId, text);
      
      logger.info('WhatsApp message sent', {
        to: chatId,
        length: text.length
      });

      return {
        id: message.id._serialized,
        timestamp: message.timestamp
      };
    } catch (error) {
      logger.error('Failed to send WhatsApp message', {
        to,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get client info
   * @returns {Object|null} Client info
   */
  getInfo() {
    if (!this.ready || !this.client.info) {
      return null;
    }

    return {
      phone: this.client.info.wid.user,
      platform: this.client.info.platform,
      pushname: this.client.info.pushname,
      ready: this.ready
    };
  }

  /**
   * Check if client is ready
   * @returns {boolean} Ready status
   */
  isReady() {
    return this.ready;
  }
}

/**
 * Create and configure WhatsApp channel
 * @param {Object} config - Channel configuration
 * @param {Function} messageHandler - Message handler function
 * @returns {WhatsAppChannel} WhatsApp channel instance
 */
export async function createWhatsAppChannel(config, messageHandler) {
  const channel = new WhatsAppChannel(config);
  
  if (messageHandler) {
    channel.onMessage(messageHandler);
  }

  await channel.start();
  
  return channel;
}
