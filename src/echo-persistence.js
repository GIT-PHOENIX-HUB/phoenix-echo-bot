/**
 * Phoenix Echo Bot - Echo Persistence
 *
 * Conversation context storage across sessions. Per-user memory for preferences
 * and past interactions, per-channel state tracking. JSONL-based storage
 * consistent with existing session.js patterns.
 */

import { readFile, appendFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getDefaultLogger } from './logger.js';

/** @typedef {import('./types.js').EchoContext} EchoContext */

const logger = getDefaultLogger().child({ component: 'echo-persistence' });

/**
 * Maximum context entries per user before summarization
 */
const MAX_USER_MEMORY_ENTRIES = 200;

/**
 * Maximum context entries per channel before pruning
 */
const MAX_CHANNEL_STATE_ENTRIES = 100;

export class EchoPersistence {
  /**
   * @param {string} workspace - Workspace root directory
   */
  constructor(workspace) {
    this.workspace = workspace;
    this.persistDir = join(workspace, '.phoenix-echo-memory');
    this._dirEnsured = false;

    /** @type {Map<string, Object>} In-memory cache of user memories */
    this._userMemoryCache = new Map();

    /** @type {Map<string, Object>} In-memory cache of channel states */
    this._channelStateCache = new Map();
  }

  /**
   * Ensure persistence directory exists
   * @returns {Promise<void>}
   */
  async ensureDir() {
    if (this._dirEnsured) return;
    await mkdir(this.persistDir, { recursive: true });
    this._dirEnsured = true;
  }

  /**
   * Get file path for user memory
   * @param {string} userId - User identifier
   * @returns {string}
   */
  getUserMemoryPath(userId) {
    const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.persistDir, `user-${safe}.jsonl`);
  }

  /**
   * Get file path for channel state
   * @param {string} channelId - Channel identifier
   * @returns {string}
   */
  getChannelStatePath(channelId) {
    const safe = String(channelId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.persistDir, `channel-${safe}.jsonl`);
  }

  /**
   * Load user memory from disk
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} User memory map
   */
  async loadUserMemory(userId) {
    // Check cache first
    if (this._userMemoryCache.has(userId)) {
      return this._userMemoryCache.get(userId);
    }

    await this.ensureDir();
    const path = this.getUserMemoryPath(userId);

    if (!existsSync(path)) {
      const empty = { userId, preferences: {}, context: [], lastSeen: null };
      this._userMemoryCache.set(userId, empty);
      return empty;
    }

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries = [];
      let preferences = {};
      let lastSeen = null;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'preference') {
            preferences = { ...preferences, ...entry.data };
          } else {
            entries.push(entry);
          }
          if (entry.timestamp) {
            lastSeen = entry.timestamp;
          }
        } catch {
          // Skip malformed lines
        }
      }

      const memory = { userId, preferences, context: entries, lastSeen };
      this._userMemoryCache.set(userId, memory);
      logger.debug('User memory loaded', { userId, entries: entries.length });
      return memory;
    } catch (error) {
      logger.error('Failed to load user memory', { userId, error: error.message });
      const empty = { userId, preferences: {}, context: [], lastSeen: null };
      this._userMemoryCache.set(userId, empty);
      return empty;
    }
  }

  /**
   * Append an entry to user memory
   * @param {string} userId - User identifier
   * @param {Object} entry - Memory entry
   * @returns {Promise<void>}
   */
  async appendUserMemory(userId, entry) {
    await this.ensureDir();
    const path = this.getUserMemoryPath(userId);
    const record = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    };

    await appendFile(path, JSON.stringify(record) + '\n', 'utf-8');

    // Update cache
    const memory = await this.loadUserMemory(userId);
    memory.context.push(record);
    memory.lastSeen = record.timestamp;

    // Prune if over limit
    if (memory.context.length > MAX_USER_MEMORY_ENTRIES) {
      await this._summarizeUserMemory(userId);
    }
  }

  /**
   * Set a user preference
   * @param {string} userId - User identifier
   * @param {string} key - Preference key
   * @param {*} value - Preference value
   * @returns {Promise<void>}
   */
  async setUserPreference(userId, key, value) {
    await this.ensureDir();
    const path = this.getUserMemoryPath(userId);
    const record = {
      type: 'preference',
      data: { [key]: value },
      timestamp: new Date().toISOString()
    };

    await appendFile(path, JSON.stringify(record) + '\n', 'utf-8');

    // Update cache
    const memory = await this.loadUserMemory(userId);
    memory.preferences[key] = value;
  }

  /**
   * Load channel state
   * @param {string} channelId - Channel identifier
   * @returns {Promise<Object>} Channel state
   */
  async loadChannelState(channelId) {
    if (this._channelStateCache.has(channelId)) {
      return this._channelStateCache.get(channelId);
    }

    await this.ensureDir();
    const path = this.getChannelStatePath(channelId);

    if (!existsSync(path)) {
      const empty = { channelId, state: {}, history: [] };
      this._channelStateCache.set(channelId, empty);
      return empty;
    }

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const history = [];
      let state = {};

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'state_update') {
            state = { ...state, ...entry.data };
          } else {
            history.push(entry);
          }
        } catch {
          // Skip malformed lines
        }
      }

      const channelState = { channelId, state, history };
      this._channelStateCache.set(channelId, channelState);
      return channelState;
    } catch (error) {
      logger.error('Failed to load channel state', { channelId, error: error.message });
      const empty = { channelId, state: {}, history: [] };
      this._channelStateCache.set(channelId, empty);
      return empty;
    }
  }

  /**
   * Update channel state
   * @param {string} channelId - Channel identifier
   * @param {Object} stateUpdate - State key-value updates
   * @returns {Promise<void>}
   */
  async updateChannelState(channelId, stateUpdate) {
    await this.ensureDir();
    const path = this.getChannelStatePath(channelId);
    const record = {
      type: 'state_update',
      data: stateUpdate,
      timestamp: new Date().toISOString()
    };

    await appendFile(path, JSON.stringify(record) + '\n', 'utf-8');

    const channelState = await this.loadChannelState(channelId);
    channelState.state = { ...channelState.state, ...stateUpdate };
  }

  /**
   * Build an EchoContext for a message
   * @param {Object} msg - Normalized message
   * @returns {Promise<EchoContext>}
   */
  async buildContext(msg) {
    const platform = msg.platform || 'unknown';
    const userId = msg.userId || 'anonymous';
    const channelId = msg.channelId || '';

    const [userMemory, channelState] = await Promise.all([
      this.loadUserMemory(userId),
      channelId ? this.loadChannelState(channelId) : { state: {}, history: [] }
    ]);

    return {
      sessionId: `${platform}-${channelId || userId}`,
      userId,
      platform,
      userMemory: userMemory.preferences,
      channelState: channelState.state,
      requestId: msg.id || ''
    };
  }

  /**
   * Summarize old user memory entries to keep context manageable
   * @param {string} userId
   * @returns {Promise<void>}
   * @private
   */
  async _summarizeUserMemory(userId) {
    const memory = await this.loadUserMemory(userId);
    if (memory.context.length <= MAX_USER_MEMORY_ENTRIES) return;

    const keepCount = Math.floor(MAX_USER_MEMORY_ENTRIES * 0.6);
    const toSummarize = memory.context.slice(0, -keepCount);
    const toKeep = memory.context.slice(-keepCount);

    const summaryEntry = {
      type: 'context_summary',
      data: {
        summarizedCount: toSummarize.length,
        period: {
          from: toSummarize[0]?.timestamp || null,
          to: toSummarize[toSummarize.length - 1]?.timestamp || null
        },
        topics: toSummarize
          .filter((e) => e.type === 'interaction')
          .slice(0, 5)
          .map((e) => String(e.preview || '').substring(0, 80))
      },
      timestamp: new Date().toISOString()
    };

    // Rebuild the file with preferences + summary + recent entries
    const path = this.getUserMemoryPath(userId);
    const allEntries = [];

    // Write preference entries
    for (const [key, value] of Object.entries(memory.preferences)) {
      allEntries.push({ type: 'preference', data: { [key]: value }, timestamp: new Date().toISOString() });
    }

    allEntries.push(summaryEntry);
    allEntries.push(...toKeep);

    const content = allEntries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(path, content, 'utf-8');

    // Update cache
    memory.context = [summaryEntry, ...toKeep];
    logger.info('User memory summarized', {
      userId,
      summarized: toSummarize.length,
      remaining: toKeep.length + 1
    });
  }

  /**
   * Cleanup: flush caches and release resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    this._userMemoryCache.clear();
    this._channelStateCache.clear();
    logger.info('Echo persistence cleanup complete');
  }
}

export default EchoPersistence;
