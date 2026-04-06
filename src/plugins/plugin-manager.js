/**
 * Phoenix Echo Bot - Plugin Manager
 *
 * Registry and router for skill plugins. Routes messages to the appropriate
 * plugin based on intent detection (keyword/trigger matching), with fallback
 * to general Echo conversation when no plugin matches.
 */

import { getDefaultLogger } from '../logger.js';

/** @typedef {import('../types.js').NormalizedMessage} NormalizedMessage */
/** @typedef {import('../types.js').SkillPlugin} SkillPlugin */
/** @typedef {import('../types.js').EchoContext} EchoContext */

const logger = getDefaultLogger().child({ component: 'plugin-manager' });

export class PluginManager {
  constructor() {
    /** @type {Map<string, SkillPlugin>} */
    this.plugins = new Map();
    this._initialized = false;
  }

  /**
   * Register a plugin
   * @param {SkillPlugin} plugin - Plugin to register
   */
  register(plugin) {
    if (!plugin.id) {
      throw new Error('Plugin must have an id');
    }
    if (this.plugins.has(plugin.id)) {
      logger.warn('Plugin already registered, replacing', { pluginId: plugin.id });
    }
    this.plugins.set(plugin.id, plugin);
    logger.info('Plugin registered', {
      pluginId: plugin.id,
      name: plugin.name,
      triggers: plugin.triggers?.length || 0
    });
  }

  /**
   * Unregister a plugin by ID
   * @param {string} pluginId - Plugin ID to remove
   * @returns {boolean} Whether a plugin was removed
   */
  unregister(pluginId) {
    const existed = this.plugins.has(pluginId);
    if (existed) {
      const plugin = this.plugins.get(pluginId);
      if (plugin.cleanup) {
        plugin.cleanup().catch((err) => {
          logger.error('Plugin cleanup error during unregister', {
            pluginId,
            error: err.message
          });
        });
      }
      this.plugins.delete(pluginId);
      logger.info('Plugin unregistered', { pluginId });
    }
    return existed;
  }

  /**
   * Initialize all registered plugins
   * @returns {Promise<void>}
   */
  async init() {
    const results = [];
    for (const [id, plugin] of this.plugins) {
      try {
        if (plugin.init) {
          await plugin.init();
        }
        results.push({ id, status: 'ok' });
      } catch (error) {
        logger.error('Plugin initialization failed', { pluginId: id, error: error.message });
        results.push({ id, status: 'error', error: error.message });
      }
    }
    this._initialized = true;
    logger.info('Plugin manager initialized', { plugins: results });
  }

  /**
   * Detect which plugin should handle this message based on triggers
   * @param {NormalizedMessage} msg - Normalized message
   * @returns {SkillPlugin|null} Matched plugin or null
   */
  detectPlugin(msg) {
    const text = String(msg.text || '').toLowerCase().trim();
    if (!text) return null;

    // Score each plugin by trigger match quality
    let bestMatch = null;
    let bestScore = 0;

    for (const [id, plugin] of this.plugins) {
      if (!plugin.triggers || plugin.triggers.length === 0) continue;

      for (const trigger of plugin.triggers) {
        const triggerLower = trigger.toLowerCase();

        // Exact command match (e.g. "/nec", "/job")
        if (text === triggerLower || text.startsWith(triggerLower + ' ')) {
          const score = 100 + triggerLower.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = plugin;
          }
          continue;
        }

        // Keyword match within the message
        if (text.includes(triggerLower)) {
          const score = triggerLower.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = plugin;
          }
        }
      }
    }

    if (bestMatch) {
      logger.debug('Plugin matched', {
        pluginId: bestMatch.id,
        score: bestScore,
        preview: text.substring(0, 40)
      });
    }

    return bestMatch;
  }

  /**
   * Route a message to the appropriate plugin
   * @param {NormalizedMessage} msg - Normalized message
   * @param {EchoContext} context - Echo context
   * @returns {Promise<string|null>} Plugin response or null to fall through
   */
  async route(msg, context) {
    const plugin = this.detectPlugin(msg);
    if (!plugin) {
      return null;
    }

    try {
      logger.info('Routing to plugin', {
        pluginId: plugin.id,
        requestId: context.requestId,
        platform: msg.platform
      });

      const response = await plugin.process(msg, context);
      if (response !== null && response !== undefined) {
        logger.info('Plugin handled message', {
          pluginId: plugin.id,
          requestId: context.requestId,
          responseLength: String(response).length
        });
        return response;
      }

      // Plugin declined to handle -- fall through
      return null;
    } catch (error) {
      logger.error('Plugin processing error', {
        pluginId: plugin.id,
        requestId: context.requestId,
        error: error.message
      });
      return `I encountered an error in the ${plugin.name} module. Please try again or rephrase your question.`;
    }
  }

  /**
   * List all registered plugins with metadata
   * @returns {Array<{id:string, name:string, description:string, triggers:string[]}>}
   */
  list() {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      triggers: p.triggers || []
    }));
  }

  /**
   * Clean up all plugins
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.info('Plugin manager shutting down', { pluginCount: this.plugins.size });
    for (const [id, plugin] of this.plugins) {
      try {
        if (plugin.cleanup) {
          await plugin.cleanup();
        }
      } catch (error) {
        logger.error('Plugin cleanup error', { pluginId: id, error: error.message });
      }
    }
    this.plugins.clear();
    this._initialized = false;
  }
}

export default PluginManager;
