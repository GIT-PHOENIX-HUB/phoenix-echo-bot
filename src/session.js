/**
 * Phoenix Echo Session Manager
 * 
 * Manages conversation sessions using JSONL files.
 * Each line is a message object (append-only for crash safety).
 */

import { readFile, appendFile, mkdir, readdir, writeFile, stat, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

function blockToText(block) {
  if (!block || typeof block !== 'object') {
    return '';
  }
  if (block.type === 'text') {
    return String(block.text || '');
  }
  if (block.type === 'tool_use') {
    return `[tool_use:${block.name || 'unknown'}]`;
  }
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') {
      return `[tool_result] ${block.content}`;
    }
    try {
      return `[tool_result] ${JSON.stringify(block.content)}`;
    } catch {
      return '[tool_result]';
    }
  }
  return '';
}

function contentToText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(blockToText).filter(Boolean).join(' ').trim();
  }
  if (content == null) {
    return '';
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export class SessionManager {
  constructor(workspace) {
    this.workspace = workspace;
    this.sessionsDir = join(workspace, '.phoenix-sessions');
    this._dirEnsured = false;
    this._dirEnsurePromise = null;
  }

  /**
   * Ensure sessions directory exists.
   * Uses a shared promise so concurrent callers all await the same mkdir,
   * and subsequent calls skip it entirely once the flag is set.
   */
  async ensureDir() {
    if (this._dirEnsured) return;
    if (!this._dirEnsurePromise) {
      this._dirEnsurePromise = mkdir(this.sessionsDir, { recursive: true })
        .then(() => { this._dirEnsured = true; })
        .catch((err) => { this._dirEnsurePromise = null; throw err; });
    }
    await this._dirEnsurePromise;
  }

  /**
   * Get session file path
   */
  getSessionPath(sessionId) {
    // Sanitize sessionId for filesystem
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.sessionsDir, `${safe}.jsonl`);
  }

  /**
   * Get checkpoint file path for a session
   */
  getCheckpointPath(sessionId) {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.sessionsDir, `${safe}.checkpoint.json`);
  }

  /**
   * Check whether a session file exists.
   */
  async exists(sessionId) {
    await this.ensureDir();
    return existsSync(this.getSessionPath(sessionId));
  }

  /**
   * Load session history
   * @param {string} sessionId 
   * @returns {Array} Array of message objects
   */
  async load(sessionId) {
    await this.ensureDir();
    const path = this.getSessionPath(sessionId);
    
    if (!existsSync(path)) {
      console.log(`[Session] Creating new session: ${sessionId}`);
      return [];
    }

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const messages = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          console.warn(`[Session] Invalid JSON line in ${sessionId}, skipping`);
          return null;
        }
      }).filter(Boolean);
      
      console.log(`[Session] Loaded ${messages.length} messages from ${sessionId}`);
      return messages;
    } catch (error) {
      console.error(`[Session] Error loading ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Append message to session
   * @param {string} sessionId 
   * @param {object} message 
   */
  async append(sessionId, message) {
    await this.ensureDir();
    const path = this.getSessionPath(sessionId);
    const line = JSON.stringify(message) + '\n';
    await appendFile(path, line, 'utf-8');
  }

  /**
   * Save full session (overwrite)
   * @param {string} sessionId 
   * @param {Array} messages 
   */
  async save(sessionId, messages) {
    await this.ensureDir();
    const path = this.getSessionPath(sessionId);
    const content = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
    await writeFile(path, content, 'utf-8');
  }

  /**
   * List all sessions
   * @returns {Array} Session IDs
   */
  async list() {
    await this.ensureDir();
    const files = await readdir(this.sessionsDir);
    return files
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.checkpoint.json'))
      .map(f => f.replace('.jsonl', ''));
  }

  /**
   * List sessions with metadata for recovery UIs.
   * Reads each session file once and parses only the last line to build the
   * preview, avoiding the overhead of fully parsing every message.
   * @returns {Array<{sessionId:string,messageCount:number,updatedAt:string,lastRole:string|null,preview:string}>}
   */
  async listDetailed() {
    const sessions = await this.list();
    const details = await Promise.all(
      sessions.map(async (sessionId) => {
        const path = this.getSessionPath(sessionId);
        let messageCount = 0;
        let updatedAt = null;
        let lastRole = null;
        let preview = '';

        try {
          const info = await stat(path);
          updatedAt = info.mtime.toISOString();
        } catch {
          // best-effort metadata only
        }

        try {
          const content = await readFile(path, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          messageCount = lines.length;
          if (lines.length > 0) {
            try {
              const last = JSON.parse(lines[lines.length - 1]);
              lastRole = last.role || null;
              if (typeof last.content === 'string') {
                preview = last.content.slice(0, 120);
              }
            } catch {
              // ignore parse error on last line
            }
          }
        } catch {
          // file may not exist or be unreadable
        }

        return {
          sessionId,
          messageCount,
          updatedAt,
          lastRole,
          preview
        };
      })
    );

    return details.sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return a.sessionId.localeCompare(b.sessionId);
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  /**
   * Clear session history
   * @param {string} sessionId 
   */
  async clear(sessionId) {
    const path = this.getSessionPath(sessionId);
    if (existsSync(path)) {
      await writeFile(path, '', 'utf-8');
      console.log(`[Session] Cleared: ${sessionId}`);
    }
  }

  /**
   * Estimate token count (rough approximation: 1 token ≈ 4 characters)
   */
  estimateTokens(text) {
    const normalized = contentToText(text);
    if (!normalized) return 0;
    return Math.ceil(normalized.length / 4);
  }

  /**
   * Calculate total tokens in message history
   */
  calculateContextTokens(messages) {
    return messages.reduce((total, msg) => {
      const contentTokens = this.estimateTokens(msg.content);
      return total + contentTokens;
    }, 0);
  }

  /**
   * Create a summary message from old messages
   */
  createSummaryMessage(messages, fromIndex, toIndex) {
    const slice = messages.slice(fromIndex, toIndex);
    const userMessages = slice.filter(m => m.role === 'user').length;
    const assistantMessages = slice.filter(m => m.role === 'assistant').length;
    
    const summary = [
      `[Context Summary: ${slice.length} messages compacted]`,
      `Period: ${slice[0]?.ts || 'unknown'} to ${slice[slice.length - 1]?.ts || 'unknown'}`,
      `Messages: ${userMessages} from user, ${assistantMessages} from assistant`,
      '',
      'Key topics discussed:',
      ...slice.slice(0, 5).map((m, i) => {
        const preview = typeof m.content === 'string' 
          ? m.content.slice(0, 100).replace(/\n/g, ' ')
          : contentToText(m.content).slice(0, 100).replace(/\n/g, ' ');
        return `- ${m.role}: ${preview}...`;
      })
    ].join('\n');

    return {
      role: 'assistant',
      content: summary,
      ts: new Date().toISOString(),
      compacted: true,
      originalCount: slice.length
    };
  }

  /**
   * Compact session (reduce context size intelligently)
   * 
   * Strategies:
   * - keep-recent: Keep last N messages, summarize the rest
   * - token-limit: Keep compacting until under token limit
   * - smart: Keep recent + important messages, summarize middle
   */
  async compact(sessionId, options = {}) {
    const strategy = options.strategy || 'keep-recent';
    const keepCount = options.keepCount || 50;
    const tokenLimit = options.tokenLimit || 180000;

    const messages = await this.load(sessionId);
    const originalCount = messages.length;
    const originalTokens = this.calculateContextTokens(messages);

    // Nothing to compact if under limits
    if (messages.length <= keepCount && originalTokens < tokenLimit) {
      return {
        originalCount,
        finalCount: originalCount,
        originalTokens,
        finalTokens: originalTokens,
        compacted: false
      };
    }

    let compacted = [];

    if (strategy === 'keep-recent') {
      // Simple strategy: keep last N messages, summarize everything else
      if (messages.length > keepCount) {
        const toSummarize = messages.slice(0, -keepCount);
        const toKeep = messages.slice(-keepCount);
        
        if (toSummarize.length > 0) {
          const summary = this.createSummaryMessage(messages, 0, toSummarize.length);
          compacted = [summary, ...toKeep];
        } else {
          compacted = toKeep;
        }
      } else {
        compacted = messages;
      }
    } else if (strategy === 'token-limit') {
      // More aggressive: keep removing oldest messages until under token limit
      compacted = messages.slice();
      let tokens = this.calculateContextTokens(compacted);
      let summarizedCount = 0;

      while (tokens > tokenLimit && compacted.length > keepCount) {
        // Remove oldest 25% of messages and replace with summary
        const removeCount = Math.max(1, Math.floor(compacted.length * 0.25));
        const removed = compacted.slice(0, removeCount);
        const summary = this.createSummaryMessage(compacted, 0, removeCount);
        
        compacted = [summary, ...compacted.slice(removeCount)];
        summarizedCount += removed.length;
        tokens = this.calculateContextTokens(compacted);
      }
    } else {
      // Default to keep-recent
      compacted = messages.slice(-keepCount);
    }

    await this.save(sessionId, compacted);
    
    const finalTokens = this.calculateContextTokens(compacted);
    const result = {
      originalCount,
      finalCount: compacted.length,
      originalTokens,
      finalTokens,
      compacted: true,
      tokensSaved: originalTokens - finalTokens,
      compressionRatio: ((1 - (finalTokens / originalTokens)) * 100).toFixed(1) + '%'
    };

    console.log(`[Session] Compacted ${sessionId}: ${originalCount} messages (${originalTokens} tokens) -> ${compacted.length} messages (${finalTokens} tokens)`);
    
    return result;
  }

  /**
   * Persist a recovery snapshot for the session.
   * This is separate from the append-only log and optimized for quick resume.
   */
  async snapshot(sessionId, keepLast = 30) {
    const messages = await this.load(sessionId);
    const recent = messages.slice(-keepLast).map((m) => ({
      role: m.role,
      content: contentToText(m.content).slice(0, 2000),
      ts: m.ts || null
    }));

    const payload = {
      sessionId,
      updatedAt: new Date().toISOString(),
      messageCount: messages.length,
      recent
    };

    const checkpointPath = this.getCheckpointPath(sessionId);
    await writeFile(checkpointPath, JSON.stringify(payload, null, 2), 'utf-8');
    return payload;
  }

  /**
   * Load the latest recovery snapshot if present.
   */
  async loadCheckpoint(sessionId) {
    const checkpointPath = this.getCheckpointPath(sessionId);
    if (!existsSync(checkpointPath)) {
      return null;
    }

    try {
      const content = await readFile(checkpointPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Rename a session and its checkpoint atomically (best effort).
   * Throws when source does not exist or destination already exists.
   */
  async renameSession(fromSessionId, toSessionId) {
    await this.ensureDir();
    const fromPath = this.getSessionPath(fromSessionId);
    const toPath = this.getSessionPath(toSessionId);
    const fromCheckpoint = this.getCheckpointPath(fromSessionId);
    const toCheckpoint = this.getCheckpointPath(toSessionId);

    if (!existsSync(fromPath)) {
      throw new Error(`Session not found: ${fromSessionId}`);
    }
    if (existsSync(toPath)) {
      throw new Error(`Target session already exists: ${toSessionId}`);
    }
    if (existsSync(toCheckpoint)) {
      throw new Error(`Target checkpoint already exists: ${toSessionId}`);
    }

    await rename(fromPath, toPath);

    if (existsSync(fromCheckpoint)) {
      await rename(fromCheckpoint, toCheckpoint);
      try {
        const checkpoint = await this.loadCheckpoint(toSessionId);
        if (checkpoint && typeof checkpoint === 'object') {
          checkpoint.sessionId = toSessionId;
          checkpoint.updatedAt = new Date().toISOString();
          await writeFile(toCheckpoint, JSON.stringify(checkpoint, null, 2), 'utf-8');
        }
      } catch {
        // Keep renamed checkpoint file even if metadata rewrite fails.
      }
    }

    return {
      fromSessionId: fromSessionId.replace(/[^a-zA-Z0-9_-]/g, '_'),
      toSessionId: toSessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    };
  }
}

export default SessionManager;
