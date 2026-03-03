/**
 * Phoenix Echo Gateway - Microsoft Teams Channel Adapter
 * 
 * Uses Azure Bot Framework SDK for Teams integration.
 * Messaging endpoint /api/messages, activity handling, conversational flow.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BotFrameworkAdapter, TurnContext, ActivityTypes } = require('botbuilder');
import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger();

export class TeamsChannel {
  constructor(config = {}) {
    this.config = config;
    this.adapter = null;
    this.messageHandler = null;
    
    const {
      appId,
      appPassword,
      appTenantId
    } = config;

    if (!appId || !appPassword) {
      throw new Error('Teams channel requires appId and appPassword');
    }

    // Create Bot Framework adapter
    this.adapter = new BotFrameworkAdapter({
      appId,
      appPassword,
      channelAuthTenant: appTenantId
    });

    // Error handler
    this.adapter.onTurnError = async (context, error) => {
      logger.error('Teams adapter error', {
        error: error.message,
        stack: error.stack,
        conversationId: context.activity?.conversation?.id
      });

      // Send error message to user
      await context.sendActivity('Sorry, something went wrong. Please try again.');
    };

    logger.info('TeamsChannel initialized', {
      appId,
      hasTenantId: !!appTenantId
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
   * Create Express.js route handler for /api/messages endpoint
   * @returns {Function} Express route handler
   */
  createRouteHandler() {
    return async (req, res) => {
      try {
        await this.adapter.process(req, res, async (context) => {
          await this.handleActivity(context);
        });
      } catch (error) {
        logger.error('Teams route handler error', {
          error: error.message,
          stack: error.stack
        });
        if (!res.headersSent && !res.writableEnded) {
          res.status(500).send('Internal server error');
        } else {
          logger.warn('Teams route handler suppressed fallback response after headers sent');
        }
      }
    };
  }

  /**
   * Handle incoming activity
   * @param {TurnContext} context - Bot turn context
   */
  async handleActivity(context) {
    const activity = context.activity;

    logger.info('Teams activity received', {
      type: activity.type,
      from: activity.from?.name,
      conversationId: activity.conversation?.id,
      channelId: activity.channelId
    });

    // Handle different activity types
    switch (activity.type) {
      case ActivityTypes.Message:
        await this.handleMessage(context);
        break;

      case ActivityTypes.ConversationUpdate:
        await this.handleConversationUpdate(context);
        break;

      case ActivityTypes.Invoke:
        await this.handleInvoke(context);
        break;

      default:
        logger.info('Unhandled activity type', { type: activity.type });
    }
  }

  /**
   * Handle message activity
   * @param {TurnContext} context - Bot turn context
   */
  async handleMessage(context) {
    const activity = context.activity;
    const text = activity.text?.trim();

    if (!text) {
      logger.info('Received empty message, ignoring');
      return;
    }

    try {
      // Send typing indicator
      await context.sendActivity({ type: ActivityTypes.Typing });

      // Call message handler if registered
      if (this.messageHandler) {
        await this.messageHandler({
          id: activity.id,
          conversationId: activity.conversation.id,
          from: activity.from.id,
          fromName: activity.from.name,
          text: text,
          timestamp: activity.timestamp,
          channelData: activity.channelData,
          reply: async (responseText) => {
            await context.sendActivity(responseText);
          },
          context // Pass full context for advanced operations
        });
      } else {
        // Default response if no handler
        await context.sendActivity('Message received, but no handler configured.');
      }
    } catch (error) {
      logger.error('Error handling Teams message', {
        error: error.message,
        conversationId: activity.conversation.id
      });
      await context.sendActivity('Sorry, I encountered an error processing your message.');
    }
  }

  /**
   * Handle conversation update (member added/removed)
   * @param {TurnContext} context - Bot turn context
   */
  async handleConversationUpdate(context) {
    const activity = context.activity;

    // Bot was added to conversation
    if (activity.membersAdded && activity.membersAdded.length > 0) {
      for (const member of activity.membersAdded) {
        if (member.id !== activity.recipient.id) {
          // New user joined
          logger.info('User joined Teams conversation', {
            userId: member.id,
            userName: member.name,
            conversationId: activity.conversation.id
          });

          await context.sendActivity(
            `👋 Welcome! I'm Phoenix Echo, your AI assistant. How can I help you today?`
          );
        } else {
          // Bot was added
          logger.info('Phoenix Echo bot added to Teams conversation', {
            conversationId: activity.conversation.id
          });
        }
      }
    }

    // Member removed
    if (activity.membersRemoved && activity.membersRemoved.length > 0) {
      for (const member of activity.membersRemoved) {
        logger.info('Member removed from Teams conversation', {
          userId: member.id,
          userName: member.name,
          conversationId: activity.conversation.id
        });
      }
    }
  }

  /**
   * Handle invoke activity (adaptive cards, messaging extensions)
   * @param {TurnContext} context - Bot turn context
   */
  async handleInvoke(context) {
    const activity = context.activity;
    
    logger.info('Teams invoke activity', {
      name: activity.name,
      conversationId: activity.conversation.id
    });

    // Handle different invoke types
    switch (activity.name) {
      case 'adaptiveCard/action':
        // Adaptive card action submitted
        await context.sendActivity('Card action received.');
        break;

      default:
        logger.warn('Unhandled invoke activity', { name: activity.name });
    }
  }

  /**
   * Send a proactive message to a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} text - Message text
   */
  async sendProactiveMessage(conversationId, text) {
    try {
      const conversationReference = {
        conversation: { id: conversationId },
        serviceUrl: this.config.serviceUrl || 'https://smba.trafficmanager.net/amer/'
      };

      await this.adapter.continueConversation(
        conversationReference,
        async (context) => {
          await context.sendActivity(text);
        }
      );

      logger.info('Proactive Teams message sent', {
        conversationId,
        length: text.length
      });
    } catch (error) {
      logger.error('Failed to send proactive Teams message', {
        conversationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get adapter instance (for advanced operations)
   * @returns {BotFrameworkAdapter} Bot Framework adapter
   */
  getAdapter() {
    return this.adapter;
  }
}

/**
 * Create and configure Teams channel
 * @param {Object} config - Channel configuration
 * @param {Function} messageHandler - Message handler function
 * @returns {TeamsChannel} Teams channel instance
 */
export function createTeamsChannel(config, messageHandler) {
  const channel = new TeamsChannel(config);
  
  if (messageHandler) {
    channel.onMessage(messageHandler);
  }

  return channel;
}
