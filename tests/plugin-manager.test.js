/**
 * Tests for PluginManager - registration, routing, fallback
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PluginManager } from '../src/plugins/plugin-manager.js';

describe('PluginManager', () => {
  /** @type {PluginManager} */
  let manager;

  const makePlugin = (id, triggers, handler = null) => ({
    id,
    name: `Test ${id}`,
    description: `Test plugin ${id}`,
    triggers,
    process: handler || (async () => `Response from ${id}`),
    init: async () => {},
    cleanup: async () => {}
  });

  const makeMsg = (text) => ({
    id: 'test-msg',
    platform: 'test',
    channelId: 'ch',
    userId: 'u',
    userName: 'Test',
    text,
    attachments: [],
    metadata: {},
    timestamp: new Date().toISOString()
  });

  const makeContext = () => ({
    sessionId: 'test-session',
    userId: 'u',
    platform: 'test',
    userMemory: {},
    channelState: {},
    requestId: 'req-1'
  });

  beforeEach(() => {
    manager = new PluginManager();
  });

  describe('register / unregister', () => {
    it('should register a plugin', () => {
      const plugin = makePlugin('test-1', ['/test']);
      manager.register(plugin);
      assert.equal(manager.plugins.size, 1);
    });

    it('should throw when plugin has no id', () => {
      assert.throws(() => {
        manager.register({ name: 'No ID' });
      }, /id/);
    });

    it('should replace existing plugin with same id', () => {
      manager.register(makePlugin('dup', ['/a']));
      manager.register(makePlugin('dup', ['/b']));
      assert.equal(manager.plugins.size, 1);
      assert.deepEqual(manager.plugins.get('dup').triggers, ['/b']);
    });

    it('should unregister a plugin', () => {
      manager.register(makePlugin('rm', ['/rm']));
      assert.ok(manager.unregister('rm'));
      assert.equal(manager.plugins.size, 0);
    });

    it('should return false when unregistering non-existent plugin', () => {
      assert.equal(manager.unregister('nope'), false);
    });
  });

  describe('detectPlugin', () => {
    it('should match exact command trigger', () => {
      const plugin = makePlugin('cmd', ['/nec']);
      manager.register(plugin);

      const matched = manager.detectPlugin(makeMsg('/nec 210'));
      assert.equal(matched.id, 'cmd');
    });

    it('should match keyword trigger in message', () => {
      const plugin = makePlugin('kw', ['wire size', 'wire sizing']);
      manager.register(plugin);

      const matched = manager.detectPlugin(makeMsg('What wire size for 30 amps?'));
      assert.equal(matched.id, 'kw');
    });

    it('should return null when no triggers match', () => {
      manager.register(makePlugin('nope', ['/obscure']));
      const matched = manager.detectPlugin(makeMsg('Hello world'));
      assert.equal(matched, null);
    });

    it('should prefer longer trigger match', () => {
      manager.register(makePlugin('short', ['code']));
      manager.register(makePlugin('long', ['electrical code']));

      const matched = manager.detectPlugin(makeMsg('Look up electrical code'));
      assert.equal(matched.id, 'long');
    });

    it('should return null for empty text', () => {
      manager.register(makePlugin('any', ['hello']));
      assert.equal(manager.detectPlugin(makeMsg('')), null);
    });
  });

  describe('route', () => {
    it('should return plugin response when matched', async () => {
      manager.register(makePlugin('echo', ['/echo']));
      const response = await manager.route(makeMsg('/echo test'), makeContext());
      assert.equal(response, 'Response from echo');
    });

    it('should return null when no plugin matches (fallback)', async () => {
      manager.register(makePlugin('only', ['/specific']));
      const response = await manager.route(makeMsg('General question'), makeContext());
      assert.equal(response, null);
    });

    it('should return null when plugin process returns null', async () => {
      manager.register(makePlugin('passthrough', ['hello'], async () => null));
      const response = await manager.route(makeMsg('hello world'), makeContext());
      assert.equal(response, null);
    });

    it('should return error message when plugin throws', async () => {
      manager.register(makePlugin('broken', ['/broken'], async () => {
        throw new Error('Plugin error');
      }));
      const response = await manager.route(makeMsg('/broken'), makeContext());
      assert.ok(response.includes('error'), 'Should contain error text');
    });
  });

  describe('list', () => {
    it('should list all registered plugins', () => {
      manager.register(makePlugin('a', ['/a']));
      manager.register(makePlugin('b', ['/b']));
      const list = manager.list();
      assert.equal(list.length, 2);
      assert.deepEqual(list.map((p) => p.id).sort(), ['a', 'b']);
    });
  });

  describe('init and cleanup', () => {
    it('should initialize all plugins', async () => {
      let initCount = 0;
      const plugin = {
        ...makePlugin('init-test', []),
        init: async () => { initCount++; }
      };
      manager.register(plugin);
      await manager.init();
      assert.equal(initCount, 1);
      assert.ok(manager._initialized);
    });

    it('should cleanup all plugins', async () => {
      let cleanupCount = 0;
      const plugin = {
        ...makePlugin('cleanup-test', []),
        cleanup: async () => { cleanupCount++; }
      };
      manager.register(plugin);
      await manager.cleanup();
      assert.equal(cleanupCount, 1);
      assert.equal(manager.plugins.size, 0);
    });
  });
});
