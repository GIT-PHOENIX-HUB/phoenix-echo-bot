/**
 * Tests for GatewayClient - connection states, reconnection
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayClient } from '../src/gateway-client.js';

describe('GatewayClient', () => {
  /** @type {GatewayClient} */
  let client;

  beforeEach(() => {
    client = new GatewayClient({
      url: '', // Empty URL prevents actual connection
      token: 'test-token'
    });
  });

  afterEach(async () => {
    await client.cleanup();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      const state = client.getState();
      assert.equal(state.status, 'CLOSED');
      assert.equal(state.reconnectAttempts, 0);
      assert.equal(state.lastConnectedAt, null);
      assert.equal(state.lastError, null);
    });
  });

  describe('getState', () => {
    it('should return a copy of the state', () => {
      const state1 = client.getState();
      const state2 = client.getState();
      assert.notEqual(state1, state2, 'Should return different objects');
      assert.deepEqual(state1, state2, 'Should have same values');
    });

    it('should include heartbeat interval', () => {
      const state = client.getState();
      assert.equal(state.heartbeatIntervalMs, 25000);
    });
  });

  describe('connect with no URL', () => {
    it('should not connect when URL is empty', async () => {
      await client.connect();
      const state = client.getState();
      assert.equal(state.status, 'CLOSED');
    });
  });

  describe('state change callback', () => {
    it('should call onStateChange when state changes', async () => {
      const changes = [];
      client.onStateChange = (newState, previousStatus) => {
        changes.push({ status: newState.status, from: previousStatus });
      };

      // Manually trigger a state change
      client._updateState('CONNECTING');
      assert.equal(changes.length, 1);
      assert.equal(changes[0].status, 'CONNECTING');
      assert.equal(changes[0].from, 'CLOSED');
    });

    it('should not call onStateChange for same state', () => {
      const changes = [];
      client.onStateChange = (newState, prev) => {
        changes.push(newState.status);
      };

      client._updateState('CLOSED'); // same as initial
      assert.equal(changes.length, 0);
    });
  });

  describe('cleanup', () => {
    it('should set destroyed flag and close state', async () => {
      client._updateState('CONNECTING');
      await client.cleanup();
      assert.equal(client._destroyed, true);
      assert.equal(client.getState().status, 'CLOSED');
    });

    it('should clear all timers', async () => {
      client._heartbeatTimer = setInterval(() => {}, 10000);
      client._reconnectTimer = setTimeout(() => {}, 10000);
      client._circuitBreakerTimer = setTimeout(() => {}, 10000);

      await client.cleanup();
      assert.equal(client._heartbeatTimer, null);
      assert.equal(client._reconnectTimer, null);
      assert.equal(client._circuitBreakerTimer, null);
    });

    it('should prevent reconnection after destroy', async () => {
      await client.cleanup();
      client.url = 'ws://localhost:9999/ws';
      await client.connect();
      assert.equal(client.getState().status, 'CLOSED');
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', () => {
      const changes = [];
      client.onStateChange = (state) => {
        changes.push(state.status);
      };

      client._consecutiveFailures = 10;
      client._openCircuitBreaker();

      assert.equal(client.getState().status, 'CIRCUIT_OPEN');

      // Clean up the timer
      if (client._circuitBreakerTimer) {
        clearTimeout(client._circuitBreakerTimer);
        client._circuitBreakerTimer = null;
      }
    });
  });
});
