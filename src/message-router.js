/**
 * Phoenix Echo Gateway - Message Router
 *
 * Routes messages to registered channel adapters.
 * Replaces the old channels-integration.js ChannelsManager.
 */

import { randomUUID } from 'crypto';
import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger();

export class MessageRouter {
  constructor() {
    this.adapters = new Map();
    this.handleMessage = null;
    this.pluginRouter = null;
  }

  registerAdapter(name, adapter) {
    this.adapters.set(name, adapter);
    logger.info('Registered channel adapter', { channel: name });
  }

  async sendMessage(channelName, target, message) {
    const adapter = this.adapters.get(channelName);
    if (!adapter) {
      throw new Error(`Channel adapter not found: ${channelName}`);
    }
    return await adapter.sendMessage(target, message);
  }

  normalize(platform, raw = {}) {
    const adapter = this.adapters.get(platform);
    if (typeof adapter?.normalizeInbound === 'function') {
      return adapter.normalizeInbound(raw);
    }
    return {
      id: raw.id || randomUUID(),
      platform,
      channelId: String(raw.channelId || ''),
      userId: String(raw.userId || ''),
      userName: String(raw.userName || ''),
      text: String(raw.text || ''),
      attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
      metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
      timestamp: raw.timestamp || new Date().toISOString()
    };
  }

  formatOutbound(text, platform) {
    const adapter = this.adapters.get(platform);
    if (typeof adapter?.formatResponse === 'function') {
      return adapter.formatResponse(text);
    }
    return text;
  }

  async routeInbound(message, context = {}) {
    try {
      if (typeof this.pluginRouter === 'function') {
        const pluginResponse = await this.pluginRouter(message, context);
        if (pluginResponse != null) {
          return pluginResponse;
        }
      }
      if (typeof this.handleMessage !== 'function') {
        throw new Error('No inbound message handler configured');
      }
      const sessionId = `${message.platform}-${message.channelId}`;
      return await this.handleMessage(sessionId, message.text, {
        ...context,
        source: message.platform,
        userId: message.userId,
        userName: message.userName
      });
    } catch (error) {
      logger.error('Inbound message routing failed', { error: error.message });
      return 'Sorry, an error occurred while routing your message.';
    }
  }

  getStatus() {
    const channels = {};
    for (const [name, adapter] of this.adapters) {
      channels[name] = {
        registered: true,
        ready: typeof adapter.isReady === 'function' ? adapter.isReady() : true
      };
    }
    return channels;
  }

  async cleanup() {
    for (const [name, adapter] of this.adapters) {
      try {
        if (typeof adapter.cleanup === 'function') {
          await adapter.cleanup();
        } else if (typeof adapter.stop === 'function') {
          await adapter.stop();
        }
        logger.info('Channel adapter stopped', { channel: name });
      } catch (error) {
        logger.error('Error stopping channel adapter', {
          channel: name,
          error: error.message
        });
      }
    }
    this.adapters.clear();
    logger.info('All channel adapters cleaned up');
  }
}
