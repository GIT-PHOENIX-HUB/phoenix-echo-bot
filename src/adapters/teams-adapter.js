/**
 * Phoenix Echo Bot - Microsoft Teams Adapter
 *
 * Uses Bot Framework (botbuilder) for message handling, adaptive cards for
 * rich responses, and proactive messaging support.
 */

import { randomUUID } from 'crypto';
import { BaseAdapter } from './base-adapter.js';

/** @typedef {import('../types.js').NormalizedMessage} NormalizedMessage */

export class TeamsAdapter extends BaseAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.config - Teams configuration
   * @param {string} options.config.appId - Bot Framework App ID
   * @param {string} options.config.appPassword - Bot Framework App Password
   * @param {string} [options.config.appTenantId] - Azure AD Tenant ID
   * @param {Function} [options.onMessage] - Inbound message callback
   */
  constructor(options = {}) {
    super({ ...options, platform: 'teams' });
    this.appId = this.config.appId || '';
    this.appPassword = this.config.appPassword || '';
    this.tenantId = this.config.appTenantId || '';
    this.adapter = null;
    this.conversationReferences = new Map();
  }

  /** @returns {Promise<void>} */
  async init() {
    if (!this.appId || !this.appPassword) {
      this.logger.warn('Teams adapter disabled: missing appId or appPassword');
      return;
    }

    try {
      // TODO(gateway): Dynamic import to avoid crash when botbuilder is not installed
      const { CloudAdapter, ConfigurationBotFrameworkAuthentication } = await import('botbuilder');

      const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
        MicrosoftAppId: this.appId,
        MicrosoftAppPassword: this.appPassword,
        MicrosoftAppTenantId: this.tenantId
      });

      this.adapter = new CloudAdapter(botFrameworkAuth);

      this.adapter.onTurnError = async (context, error) => {
        this.logger.error('Teams turn error', { error: error.message });
        try {
          await context.sendActivity('Sorry, something went wrong processing your request.');
        } catch (sendError) {
          this.logger.error('Failed to send error message', { error: sendError.message });
        }
      };

      await super.init();
      this.logger.info('Teams adapter initialized', { appId: this.appId });
    } catch (error) {
      this.logger.error('Failed to initialize Teams adapter', { error: error.message });
      throw error;
    }
  }

  /** @returns {Promise<void>} */
  async shutdown() {
    this.conversationReferences.clear();
    this.adapter = null;
    await super.shutdown();
  }

  /**
   * Create an Express route handler for the /api/messages endpoint
   * @returns {Function} Express middleware
   */
  createRouteHandler() {
    return async (req, res) => {
      if (!this.adapter) {
        return res.status(503).json({ error: 'Teams adapter not initialized' });
      }

      await this.adapter.process(req, res, async (context) => {
        if (context.activity.type === 'message') {
          // Store conversation reference for proactive messaging
          const ref = {
            activityId: context.activity.id,
            user: context.activity.from,
            bot: context.activity.recipient,
            conversation: context.activity.conversation,
            channelId: context.activity.channelId,
            serviceUrl: context.activity.serviceUrl
          };
          this.conversationReferences.set(context.activity.conversation.id, ref);

          const normalized = this.normalizeInbound(context.activity);

          if (this.onMessage) {
            const response = await this.onMessage(normalized);
            if (response) {
              const formatted = this.formatResponse(response);
              await context.sendActivity(formatted);
            }
          }
        }
      });
    };
  }

  /**
   * Send a message to a Teams conversation
   * @param {string} channelId - Conversation ID
   * @param {string} text - Message text
   * @param {Object} [options] - Options (adaptiveCard, etc.)
   * @returns {Promise<void>}
   */
  async sendMessage(channelId, text, options = {}) {
    if (!this.adapter) {
      throw new Error('Teams adapter not initialized');
    }

    const ref = this.conversationReferences.get(channelId);
    if (!ref) {
      throw new Error(`No conversation reference for channel: ${channelId}`);
    }

    // TODO(gateway): Implement proactive messaging with MicrosoftAppCredentials
    await this.adapter.continueConversationAsync(this.appId, ref, async (context) => {
      if (options.adaptiveCard) {
        await context.sendActivity({
          attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: options.adaptiveCard
          }]
        });
      } else {
        await context.sendActivity(this.formatResponse(text));
      }
    });
  }

  /**
   * Build an adaptive card from structured data
   * @param {Object} data - Card data
   * @param {string} data.title - Card title
   * @param {string} [data.body] - Card body text
   * @param {Array<{title:string, url?:string, data?:Object}>} [data.actions] - Action buttons
   * @returns {Object} Adaptive card JSON
   */
  buildAdaptiveCard(data) {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: data.title,
          weight: 'Bolder',
          size: 'Medium'
        }
      ]
    };

    if (data.body) {
      card.body.push({
        type: 'TextBlock',
        text: data.body,
        wrap: true
      });
    }

    if (data.actions && data.actions.length > 0) {
      card.actions = data.actions.map((action) => {
        if (action.url) {
          return {
            type: 'Action.OpenUrl',
            title: action.title,
            url: action.url
          };
        }
        return {
          type: 'Action.Submit',
          title: action.title,
          data: action.data || {}
        };
      });
    }

    return card;
  }

  /**
   * Format response text for Teams markdown rendering
   * @param {string} text - Raw text
   * @returns {string}
   */
  formatResponse(text) {
    // Teams supports a subset of markdown. Ensure code blocks render properly.
    return String(text || '');
  }

  /**
   * Normalize a Teams activity into NormalizedMessage
   * @param {Object} activity - Bot Framework activity
   * @returns {NormalizedMessage}
   */
  normalizeInbound(activity) {
    return {
      id: activity.id || randomUUID(),
      platform: 'teams',
      channelId: activity.conversation?.id || '',
      userId: activity.from?.id || '',
      userName: activity.from?.name || '',
      text: activity.text || '',
      attachments: (activity.attachments || []).map((att) => ({
        type: att.contentType || 'unknown',
        url: att.contentUrl || '',
        name: att.name || ''
      })),
      metadata: {
        conversationId: activity.conversation?.id,
        tenantId: activity.conversation?.tenantId,
        serviceUrl: activity.serviceUrl,
        channelId: activity.channelId
      },
      timestamp: activity.timestamp || new Date().toISOString()
    };
  }
}

export default TeamsAdapter;
