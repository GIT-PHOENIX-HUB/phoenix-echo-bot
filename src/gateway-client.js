/**
 * Phoenix Echo Bot - Gateway WebSocket Client
 *
 * WebSocket client connecting to the Phoenix Echo Gateway for real-time
 * state sync (dispatch updates, schedule changes, notifications).
 * Implements exponential backoff reconnection and heartbeat keepalive.
 */

import { getDefaultLogger } from './logger.js';

/** @typedef {import('./types.js').GatewayState} GatewayState */

const logger = getDefaultLogger().child({ component: 'gateway-client' });

/**
 * Reconnection backoff parameters
 */
const BACKOFF = {
  initialMs: 1000,
  multiplier: 2,
  maxMs: 30000,
  jitterFraction: 0.25
};

/**
 * Heartbeat interval in milliseconds
 */
const HEARTBEAT_INTERVAL_MS = 25000;

/**
 * Circuit breaker: max consecutive failures before CIRCUIT_OPEN
 */
const CIRCUIT_BREAKER_THRESHOLD = 10;

/**
 * Circuit breaker recovery wait before attempting reconnect
 */
const CIRCUIT_BREAKER_RECOVERY_MS = 60000;

export class GatewayClient {
  /**
   * @param {Object} options
   * @param {string} options.url - WebSocket URL (e.g. ws://localhost:18790/ws)
   * @param {string} [options.token] - Gateway authentication token
   * @param {Function} [options.onMessage] - Message handler
   * @param {Function} [options.onStateChange] - State change callback
   */
  constructor(options = {}) {
    this.url = options.url || '';
    this.token = options.token || '';
    this.onMessage = options.onMessage || null;
    this.onStateChange = options.onStateChange || null;

    /** @type {GatewayState} */
    this.state = {
      status: 'CLOSED',
      reconnectAttempts: 0,
      lastConnectedAt: null,
      lastError: null,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      latencyMs: 0
    };

    this._ws = null;
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._circuitBreakerTimer = null;
    this._consecutiveFailures = 0;
    this._destroyed = false;
    this._lastPingSent = 0;
  }

  /**
   * Connect to the gateway
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._destroyed) return;
    if (!this.url) {
      logger.warn('Gateway client disabled: no URL configured');
      return;
    }

    if (this.state.status === 'CIRCUIT_OPEN') {
      logger.warn('Circuit breaker is open, waiting for recovery');
      return;
    }

    this._updateState('CONNECTING');

    try {
      // Dynamic import to handle environments where ws may not be available
      const { default: WebSocket } = await import('ws');

      const wsUrl = this.token
        ? `${this.url}?token=${encodeURIComponent(this.token)}`
        : this.url;

      this._ws = new WebSocket(wsUrl);

      this._ws.on('open', () => {
        logger.info('Gateway connection established', { url: this.url });
        this._consecutiveFailures = 0;
        this.state.reconnectAttempts = 0;
        this.state.lastConnectedAt = new Date().toISOString();
        this._updateState('OPEN');
        this._startHeartbeat();

        // Send auth message if token is provided and not in URL
        if (this.token) {
          this._send({ type: 'auth', token: this.token });
        }
      });

      this._ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg);
        } catch (error) {
          logger.warn('Failed to parse gateway message', { error: error.message });
        }
      });

      this._ws.on('close', (code, reason) => {
        logger.info('Gateway connection closed', {
          code,
          reason: reason?.toString() || ''
        });
        this._stopHeartbeat();
        this._ws = null;

        if (!this._destroyed) {
          this._scheduleReconnect();
        }
      });

      this._ws.on('error', (error) => {
        logger.error('Gateway connection error', { error: error.message });
        this.state.lastError = error.message;
        this._consecutiveFailures++;

        if (this._consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          this._openCircuitBreaker();
        }
      });

    } catch (error) {
      logger.error('Failed to create gateway connection', { error: error.message });
      this.state.lastError = error.message;
      this._consecutiveFailures++;
      this._scheduleReconnect();
    }
  }

  /**
   * Send a message to the gateway
   * @param {Object} msg - Message object
   * @private
   */
  _send(msg) {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Handle incoming gateway messages
   * @param {Object} msg
   * @private
   */
  _handleMessage(msg) {
    // Handle pong for latency measurement
    if (msg.type === 'pong') {
      if (this._lastPingSent > 0) {
        this.state.latencyMs = Date.now() - this._lastPingSent;
        this._lastPingSent = 0;
      }
      return;
    }

    // Handle auth responses
    if (msg.type === 'auth') {
      if (msg.status === 'ok') {
        logger.info('Gateway authentication successful');
      } else {
        logger.error('Gateway authentication failed');
        this.state.lastError = 'Authentication failed';
        this._updateState('DEGRADED');
      }
      return;
    }

    // Handle state sync messages
    // TODO(gateway): Handle dispatch_update, schedule_change, notification
    if (msg.type === 'dispatch_update' || msg.type === 'schedule_change' || msg.type === 'notification') {
      logger.info('Gateway state sync received', { type: msg.type });
    }

    // Forward to message handler
    if (this.onMessage) {
      try {
        this.onMessage(msg);
      } catch (error) {
        logger.error('Gateway message handler error', { error: error.message });
      }
    }
  }

  /**
   * Start heartbeat ping interval
   * @private
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === 1) {
        this._lastPingSent = Date.now();
        this._send({ type: 'ping', ts: this._lastPingSent });
      }
    }, HEARTBEAT_INTERVAL_MS);

    if (typeof this._heartbeatTimer.unref === 'function') {
      this._heartbeatTimer.unref();
    }
  }

  /**
   * Stop heartbeat timer
   * @private
   */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   * @private
   */
  _scheduleReconnect() {
    if (this._destroyed) return;
    if (this.state.status === 'CIRCUIT_OPEN') return;

    this.state.reconnectAttempts++;
    const attempt = this.state.reconnectAttempts;

    // Exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 30s cap
    const baseDelay = Math.min(
      BACKOFF.initialMs * Math.pow(BACKOFF.multiplier, attempt - 1),
      BACKOFF.maxMs
    );
    const jitter = Math.floor(Math.random() * baseDelay * BACKOFF.jitterFraction);
    const delay = baseDelay + jitter;

    this._updateState('CLOSED');
    logger.info('Scheduling gateway reconnect', { attempt, delayMs: delay });

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);

    if (typeof this._reconnectTimer.unref === 'function') {
      this._reconnectTimer.unref();
    }
  }

  /**
   * Open the circuit breaker after too many consecutive failures
   * @private
   */
  _openCircuitBreaker() {
    logger.error('Circuit breaker OPEN -- too many consecutive gateway failures', {
      failures: this._consecutiveFailures,
      threshold: CIRCUIT_BREAKER_THRESHOLD
    });

    this._updateState('CIRCUIT_OPEN');

    this._circuitBreakerTimer = setTimeout(() => {
      this._circuitBreakerTimer = null;
      this._consecutiveFailures = 0;
      logger.info('Circuit breaker reset -- attempting reconnect');
      this.connect();
    }, CIRCUIT_BREAKER_RECOVERY_MS);

    if (typeof this._circuitBreakerTimer.unref === 'function') {
      this._circuitBreakerTimer.unref();
    }
  }

  /**
   * Update connection state and notify listeners
   * @param {string} status
   * @private
   */
  _updateState(status) {
    const previous = this.state.status;
    this.state.status = status;

    if (previous !== status) {
      logger.info('Gateway state changed', { from: previous, to: status });
      if (this.onStateChange) {
        try {
          this.onStateChange(this.state, previous);
        } catch (error) {
          logger.error('State change callback error', { error: error.message });
        }
      }
    }
  }

  /**
   * Get current connection state
   * @returns {GatewayState}
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Disconnect and clean up
   * @returns {Promise<void>}
   */
  async cleanup() {
    this._destroyed = true;
    this._stopHeartbeat();

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._circuitBreakerTimer) {
      clearTimeout(this._circuitBreakerTimer);
      this._circuitBreakerTimer = null;
    }

    if (this._ws) {
      try {
        this._ws.close(1000, 'Client shutting down');
      } catch {
        // Best effort close
      }
      this._ws = null;
    }

    this._updateState('CLOSED');
    logger.info('Gateway client cleanup complete');
  }
}

export default GatewayClient;
