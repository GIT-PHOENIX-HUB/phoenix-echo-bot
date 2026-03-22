/**
 * Phoenix Echo Gateway - Teams Adapter
 *
 * Wraps Microsoft Bot Framework for Teams channel integration.
 * Single instance serves both message routing and Express route handling.
 */

import { BotFrameworkAdapter } from 'botbuilder';
import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger();

export class TeamsAdapter {
  constructor(config, messageHandler) {
    this.config = config;
    this.messageHandler = messageHandler;

    this.adapter = new BotFrameworkAdapter({
      appId: config.appId || '',
      appPassword: config.appPassword || ''
    });

    this.adapter.onTurnError = async (context, error) => {
      logger.error('Teams adapter turn error', { error: error.message });
      try {
        await context.sendActivity('Sorry, an error occurred processing your message.');
      } catch (sendError) {
        logger.error('Failed to send error response to Teams', { error: sendError.message });
      }
    };

    logger.info('TeamsAdapter initialized', { appId: config.appId || '(not set)' });
  }

  createRouteHandler() {
    return (req, res) => {
      this.adapter.processActivity(req, res, async (context) => {
        if (context.activity.type === 'message') {
          const message = {
            text: context.activity.text || '',
            fromName: context.activity.from?.name || 'Unknown',
            conversationId: context.activity.conversation?.id || '',
            reply: async (text) => {
              await context.sendActivity(text);
            }
          };

          try {
            await this.messageHandler(message);
          } catch (error) {
            logger.error('Teams message handler error', { error: error.message });
            await context.sendActivity('An error occurred. Please try again.');
          }
        }
      });
    };
  }

  async sendMessage(conversationId, message) {
    logger.warn('Teams proactive messaging requires stored conversation references', {
      conversationId
    });
  }

  isReady() {
    return !!(this.config.appId && this.config.appPassword);
  }

  async cleanup() {
    logger.info('TeamsAdapter cleanup complete');
  }
}
