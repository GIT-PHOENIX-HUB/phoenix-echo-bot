/**
 * Phoenix Echo Gateway - Channels & Cron Integration
 * 
 * Integrates WhatsApp, Teams channels and cron scheduler into the main gateway.
 */

import { createWhatsAppChannel } from './channels/whatsapp.js';
import { createTelegramChannel } from './channels/telegram.js';
import { createTeamsChannel } from './channels/teams.js';
import { CronScheduler, createOvernightIntelJobs } from './cron.js';
import { getDefaultLogger } from './logger.js';

const logger = getDefaultLogger();

function normalizeCronJobType(inputType) {
  const raw = String(inputType || '').trim().toLowerCase();
  if (!raw) return 'agentTurn';
  if (raw === 'agentturn' || raw === 'agent_turn' || raw === 'agent-turn') return 'agentTurn';
  if (raw === 'systemevent' || raw === 'system_event' || raw === 'system-event') return 'systemEvent';
  return inputType;
}

export class ChannelsManager {
  constructor(config = {}, messageHandler) {
    this.config = config;
    this.messageHandler = messageHandler;
    this.channels = new Map();
    this.cronScheduler = null;
  }

  /**
   * Initialize all configured channels
   */
  async initialize() {
    logger.info('Initializing channels and cron scheduler...');

    // Initialize cron scheduler
    this.cronScheduler = new CronScheduler({
      timezone: this.config.cron?.timezone || this.config.timezone || 'America/Denver'
    });

    // Register cron handlers
    this.cronScheduler.registerHandler('systemEvent', async (job, payload) => {
      logger.info('Executing systemEvent job', { jobId: job.id, payload });
      // TODO: Inject system event into session
    });

    this.cronScheduler.registerHandler('agentTurn', async (job, payload) => {
      logger.info('Executing agentTurn job', {
        jobId: job.id,
        sessionId: payload.sessionId
      });
      
      // Call message handler with agent turn payload
      if (this.messageHandler) {
        await this.messageHandler(payload.sessionId, payload.message, {
          source: 'cron',
          jobId: job.id,
          jobName: job.name
        });
      }
    });

    // Load configured cron jobs
    const cronJobs = Array.isArray(this.config.cron?.jobs) ? this.config.cron.jobs : [];
    if (this.config.cron?.enabled && cronJobs.length > 0) {
      for (const job of cronJobs) {
        try {
          const payload = {
            ...(job.payload || {}),
            sessionId: job.payload?.sessionId || job.sessionId || 'main',
            message: job.payload?.message || job.message || ''
          };
          this.cronScheduler.scheduleJob({
            id: job.id,
            name: job.name || job.id,
            schedule: job.schedule,
            type: normalizeCronJobType(job.type),
            payload,
            enabled: job.enabled !== false,
            timezone: this.config.cron?.timezone || 'America/Denver'
          });
        } catch (error) {
          logger.error('Failed to schedule configured cron job', {
            jobId: job?.id || null,
            error: error.message
          });
        }
      }
    }

    // Create overnight intel scout jobs only when explicitly enabled
    if (this.config.cron?.enableOvernightIntel === true) {
      createOvernightIntelJobs(this.cronScheduler, this.messageHandler);
    }

    // Initialize WhatsApp channel if configured
    if (this.config.whatsapp?.enabled) {
      try {
        logger.info('Initializing WhatsApp channel...');
        
        const whatsappChannel = await createWhatsAppChannel(
          this.config.whatsapp,
          async (message) => {
            // Route WhatsApp message to gateway
            const sessionId = `whatsapp-${message.from}`;
            await this.messageHandler(sessionId, message.body, {
              source: 'whatsapp',
              from: message.fromName,
              chatId: message.chatId,
              reply: message.reply
            });
          }
        );

        this.channels.set('whatsapp', whatsappChannel);
        logger.info('WhatsApp channel initialized');
      } catch (error) {
        logger.error('Failed to initialize WhatsApp channel', {
          error: error.message
        });
      }
    }

    // Initialize Telegram channel if configured
    if (this.config.telegram?.enabled) {
      try {
        logger.info('Initializing Telegram channel...');

        const telegramChannel = await createTelegramChannel(
          this.config.telegram,
          async (message) => {
            const sessionId = `telegram-${message.chatId}`;
            await this.messageHandler(sessionId, message.text, {
              source: 'telegram',
              from: message.fromName,
              chatId: message.chatId,
              reply: message.reply
            });
          }
        );

        this.channels.set('telegram', telegramChannel);
        logger.info('Telegram channel initialized');
      } catch (error) {
        logger.error('Failed to initialize Telegram channel', {
          error: error.message
        });
      }
    }

    // Initialize Teams channel if configured
    if (this.config.teams?.enabled) {
      try {
        logger.info('Initializing Teams channel...');
        
        const teamsChannel = createTeamsChannel(
          this.config.teams,
          async (message) => {
            // Route Teams message to gateway
            const sessionId = `teams-${message.conversationId}`;
            await this.messageHandler(sessionId, message.text, {
              source: 'teams',
              from: message.fromName,
              conversationId: message.conversationId,
              reply: message.reply
            });
          }
        );

        this.channels.set('teams', teamsChannel);
        logger.info('Teams channel initialized');
      } catch (error) {
        logger.error('Failed to initialize Teams channel', {
          error: error.message
        });
      }
    }

    logger.info('Channels initialization complete', {
      channels: Array.from(this.channels.keys()),
      cronJobs: this.cronScheduler.listJobs().length
    });
  }

  /**
   * Get Teams route handler for Express
   * @returns {Function|null} Express route handler
   */
  getTeamsRouteHandler() {
    const teamsChannel = this.channels.get('teams');
    return teamsChannel ? teamsChannel.createRouteHandler() : null;
  }

  /**
   * Get WhatsApp channel
   * @returns {WhatsAppChannel|null}
   */
  getWhatsAppChannel() {
    return this.channels.get('whatsapp') || null;
  }

  /**
   * Get Telegram channel
   * @returns {TelegramChannel|null}
   */
  getTelegramChannel() {
    return this.channels.get('telegram') || null;
  }

  /**
   * Get Teams channel
   * @returns {TeamsChannel|null}
   */
  getTeamsChannel() {
    return this.channels.get('teams') || null;
  }

  /**
   * Get cron scheduler
   * @returns {CronScheduler}
   */
  getCronScheduler() {
    return this.cronScheduler;
  }

  /**
   * Send message to a specific channel
   * @param {string} channelName - Channel name ('whatsapp', 'telegram', 'teams')
   * @param {string} target - Target identifier (phone number, conversation ID)
   * @param {string} message - Message text
   */
  async sendMessage(channelName, target, message) {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel not found: ${channelName}`);
    }

    if (channelName === 'whatsapp') {
      return await channel.sendMessage(target, message);
    } else if (channelName === 'telegram') {
      return await channel.sendMessage(target, message);
    } else if (channelName === 'teams') {
      return await channel.sendProactiveMessage(target, message);
    } else {
      throw new Error(`Unsupported channel: ${channelName}`);
    }
  }

  /**
   * Shutdown all channels gracefully
   */
  async shutdown() {
    logger.info('Shutting down channels...');

    // Stop cron scheduler
    if (this.cronScheduler) {
      this.cronScheduler.shutdown();
    }

    // Stop all channels
    for (const [name, channel] of this.channels) {
      try {
        if (channel.stop) {
          await channel.stop();
          logger.info('Channel stopped', { name });
        }
      } catch (error) {
        logger.error('Error stopping channel', {
          name,
          error: error.message
        });
      }
    }

    this.channels.clear();
    logger.info('All channels shutdown complete');
  }

  /**
   * Get status of all channels
   * @returns {Object} Channel status
   */
  getStatus() {
    const status = {
      channels: {},
      cronJobs: []
    };

    for (const [name, channel] of this.channels) {
      if (name === 'whatsapp') {
        status.channels.whatsapp = {
          ready: channel.isReady(),
          info: channel.getInfo()
        };
      } else if (name === 'telegram') {
        status.channels.telegram = {
          ready: channel.isReady(),
          info: channel.getInfo()
        };
      } else if (name === 'teams') {
        status.channels.teams = {
          configured: true
        };
      }
    }

    if (this.cronScheduler) {
      status.cronJobs = this.cronScheduler.listJobs();
    }

    return status;
  }
}

/**
 * Create and initialize channels manager
 * @param {Object} config - Configuration
 * @param {Function} messageHandler - Message handler function(sessionId, message, context)
 * @returns {ChannelsManager} Channels manager instance
 */
export async function createChannelsManager(config, messageHandler) {
  const manager = new ChannelsManager(config, messageHandler);
  await manager.initialize();
  return manager;
}
