/**
 * Tests for EchoPersistence - storage, retrieval, context management
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { EchoPersistence } from '../src/echo-persistence.js';

describe('EchoPersistence', () => {
  /** @type {EchoPersistence} */
  let persistence;
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'phoenix-test-'));
    persistence = new EchoPersistence(tempDir);
  });

  afterEach(async () => {
    await persistence.cleanup();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  });

  describe('loadUserMemory', () => {
    it('should return empty memory for new user', async () => {
      const memory = await persistence.loadUserMemory('new-user');
      assert.equal(memory.userId, 'new-user');
      assert.deepEqual(memory.preferences, {});
      assert.deepEqual(memory.context, []);
      assert.equal(memory.lastSeen, null);
    });

    it('should cache user memory in-memory', async () => {
      const first = await persistence.loadUserMemory('cached-user');
      const second = await persistence.loadUserMemory('cached-user');
      assert.equal(first, second, 'Should return same object from cache');
    });
  });

  describe('appendUserMemory', () => {
    it('should append and retrieve memory entries', async () => {
      await persistence.appendUserMemory('user-1', {
        type: 'interaction',
        preview: 'Asked about wire sizing'
      });
      await persistence.appendUserMemory('user-1', {
        type: 'interaction',
        preview: 'Asked about NEC 210'
      });

      // Clear cache to force reload from disk
      persistence._userMemoryCache.clear();
      const memory = await persistence.loadUserMemory('user-1');

      assert.equal(memory.context.length, 2);
      assert.ok(memory.context[0].timestamp, 'Should have timestamp');
      assert.equal(memory.context[0].preview, 'Asked about wire sizing');
    });
  });

  describe('setUserPreference', () => {
    it('should set and retrieve preferences', async () => {
      await persistence.setUserPreference('user-pref', 'theme', 'dark');
      await persistence.setUserPreference('user-pref', 'language', 'en');

      const memory = await persistence.loadUserMemory('user-pref');
      assert.equal(memory.preferences.theme, 'dark');
      assert.equal(memory.preferences.language, 'en');
    });

    it('should persist preferences to disk', async () => {
      await persistence.setUserPreference('disk-pref', 'notifications', true);

      persistence._userMemoryCache.clear();
      const memory = await persistence.loadUserMemory('disk-pref');
      assert.equal(memory.preferences.notifications, true);
    });
  });

  describe('loadChannelState', () => {
    it('should return empty state for new channel', async () => {
      const state = await persistence.loadChannelState('new-channel');
      assert.equal(state.channelId, 'new-channel');
      assert.deepEqual(state.state, {});
      assert.deepEqual(state.history, []);
    });
  });

  describe('updateChannelState', () => {
    it('should update and retrieve channel state', async () => {
      await persistence.updateChannelState('ch-1', { topic: 'Service call' });
      await persistence.updateChannelState('ch-1', { status: 'active' });

      const state = await persistence.loadChannelState('ch-1');
      assert.equal(state.state.topic, 'Service call');
      assert.equal(state.state.status, 'active');
    });

    it('should persist state to disk', async () => {
      await persistence.updateChannelState('disk-ch', { key: 'value' });

      persistence._channelStateCache.clear();
      const state = await persistence.loadChannelState('disk-ch');
      assert.equal(state.state.key, 'value');
    });
  });

  describe('buildContext', () => {
    it('should build an EchoContext from a message', async () => {
      await persistence.setUserPreference('ctx-user', 'tone', 'casual');

      const msg = {
        id: 'msg-1',
        platform: 'telegram',
        channelId: 'tg-123',
        userId: 'ctx-user',
        userName: 'Test User',
        text: 'Hello',
        attachments: [],
        metadata: {},
        timestamp: new Date().toISOString()
      };

      const ctx = await persistence.buildContext(msg);
      assert.equal(ctx.sessionId, 'telegram-tg-123');
      assert.equal(ctx.userId, 'ctx-user');
      assert.equal(ctx.platform, 'telegram');
      assert.equal(ctx.userMemory.tone, 'casual');
      assert.equal(ctx.requestId, 'msg-1');
    });
  });

  describe('cleanup', () => {
    it('should clear all caches', async () => {
      await persistence.loadUserMemory('user-cleanup');
      await persistence.loadChannelState('ch-cleanup');

      assert.ok(persistence._userMemoryCache.size > 0);
      assert.ok(persistence._channelStateCache.size > 0);

      await persistence.cleanup();
      assert.equal(persistence._userMemoryCache.size, 0);
      assert.equal(persistence._channelStateCache.size, 0);
    });
  });
});
