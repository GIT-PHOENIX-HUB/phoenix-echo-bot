/**
 * Phoenix Echo Gateway - Message Router
 *
 * Routes messages to registered channel adapters.
 * Replaces the old channels-integration.js ChannelsManager.
 */

import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger();

export class MessageRouter {
  constructor() {
    this.adapters = new Map();
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

  getStatus() {
    const channels = {};
    for (const [name, adapter] of this.adapters) {
      channels[name] = {
        registered: true,
        ready: typeof adapter.isReady === 'function' ? adapter.isReady() : true
      };
    }
    return { channels };
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
