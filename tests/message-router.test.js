/**
 * Tests for MessageRouter - normalization, routing, formatting
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MessageRouter } from '../src/message-router.js';

describe('MessageRouter', () => {
  /** @type {MessageRouter} */
  let router;

  beforeEach(() => {
    router = new MessageRouter();
  });

  describe('normalize', () => {
    it('should create a NormalizedMessage from raw input for unknown platform', () => {
      const raw = { text: 'Hello', userId: 'user1', channelId: 'ch1' };
      const msg = router.normalize('custom', raw);

      assert.equal(msg.platform, 'custom');
      assert.equal(msg.text, 'Hello');
      assert.equal(msg.userId, 'user1');
      assert.equal(msg.channelId, 'ch1');
      assert.ok(msg.id, 'Should have an ID');
      assert.ok(msg.timestamp, 'Should have a timestamp');
    });

    it('should handle missing fields gracefully', () => {
      const msg = router.normalize('test', {});
      assert.equal(msg.platform, 'test');
      assert.equal(msg.text, '');
      assert.equal(msg.userId, '');
      assert.equal(msg.channelId, '');
      assert.deepEqual(msg.attachments, []);
    });

    it('should use adapter normalizeInbound when adapter is registered', () => {
      const mockAdapter = {
        platform: 'mock',
        init: async () => {},
        shutdown: async () => {},
        sendMessage: async () => {},
        formatResponse: (t) => t,
        normalizeInbound: (raw) => ({
          id: 'mock-id',
          platform: 'mock',
          channelId: 'mock-channel',
          userId: 'mock-user',
          userName: 'Mock User',
          text: raw.body || '',
          attachments: [],
          metadata: {},
          timestamp: '2026-01-01T00:00:00.000Z'
        }),
        isReady: () => true
      };

      router.registerAdapter('mock', mockAdapter);
      const msg = router.normalize('mock', { body: 'Test message' });

      assert.equal(msg.id, 'mock-id');
      assert.equal(msg.platform, 'mock');
      assert.equal(msg.text, 'Test message');
      assert.equal(msg.userName, 'Mock User');
    });
  });

  describe('formatOutbound', () => {
    it('should pass through text for unregistered platform', () => {
      const result = router.formatOutbound('Hello **world**', 'unknown');
      assert.equal(result, 'Hello **world**');
    });

    it('should use adapter formatResponse when registered', () => {
      const mockAdapter = {
        platform: 'html',
        init: async () => {},
        shutdown: async () => {},
        sendMessage: async () => {},
        formatResponse: (text) => `<p>${text}</p>`,
        normalizeInbound: () => ({}),
        isReady: () => true
      };

      router.registerAdapter('html', mockAdapter);
      const result = router.formatOutbound('Hello', 'html');
      assert.equal(result, '<p>Hello</p>');
    });
  });

  describe('routeInbound', () => {
    it('should route to handleMessage when no plugin matches', async () => {
      let capturedSession = null;
      let capturedText = null;

      router.handleMessage = async (sessionId, text, ctx) => {
        capturedSession = sessionId;
        capturedText = text;
        return 'Echo response';
      };

      const msg = {
        id: 'test-1',
        platform: 'telegram',
        channelId: 'ch-1',
        userId: 'u-1',
        userName: 'Test',
        text: 'Hello Echo',
        attachments: [],
        metadata: {},
        timestamp: new Date().toISOString()
      };

      const response = await router.routeInbound(msg);
      assert.equal(capturedSession, 'telegram-ch-1');
      assert.equal(capturedText, 'Hello Echo');
      assert.equal(response, 'Echo response');
    });

    it('should route to plugin when plugin matches', async () => {
      router.pluginRouter = async (msg, ctx) => {
        if (msg.text.includes('nec')) {
          return 'NEC response from plugin';
        }
        return null;
      };

      router.handleMessage = async () => 'Should not reach here';

      const msg = {
        id: 'test-2',
        platform: 'teams',
        channelId: 'ch-2',
        userId: 'u-2',
        userName: 'Test',
        text: 'nec article 210',
        attachments: [],
        metadata: {},
        timestamp: new Date().toISOString()
      };

      const response = await router.routeInbound(msg);
      assert.equal(response, 'NEC response from plugin');
    });

    it('should fall through to handleMessage when plugin returns null', async () => {
      router.pluginRouter = async () => null;
      router.handleMessage = async () => 'Fallback response';

      const msg = {
        id: 'test-3',
        platform: 'whatsapp',
        channelId: 'ch-3',
        userId: 'u-3',
        userName: 'Test',
        text: 'General question',
        attachments: [],
        metadata: {},
        timestamp: new Date().toISOString()
      };

      const response = await router.routeInbound(msg);
      assert.equal(response, 'Fallback response');
    });

    it('should return error message on handler failure', async () => {
      router.handleMessage = async () => {
        throw new Error('Handler exploded');
      };

      const msg = {
        id: 'test-4',
        platform: 'email',
        channelId: 'ch-4',
        userId: 'u-4',
        userName: 'Test',
        text: 'Trigger error',
        attachments: [],
        metadata: {},
        timestamp: new Date().toISOString()
      };

      const response = await router.routeInbound(msg);
      assert.ok(response.includes('error'), 'Should contain error message');
    });
  });

  describe('getStatus', () => {
    it('should return empty status when no adapters registered', () => {
      const status = router.getStatus();
      assert.deepEqual(status, {});
    });
  });

  describe('cleanup', () => {
    it('should clear all adapters', async () => {
      router.registerAdapter('test', {
        platform: 'test',
        init: async () => {},
        shutdown: async () => {},
        sendMessage: async () => {},
        formatResponse: (t) => t,
        normalizeInbound: () => ({}),
        isReady: () => true
      });

      assert.equal(router.adapters.size, 1);
      await router.cleanup();
      assert.equal(router.adapters.size, 0);
    });
  });
});
