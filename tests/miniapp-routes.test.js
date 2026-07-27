import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  forwardMiniAppSubmission,
  normalizeMiniAppSubmission,
  publicRuntimeReceipt,
  registerMiniAppRoutes
} from '../src/miniapp-routes.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function abortableFetch(_url, options) {
  return new Promise((_resolve, reject) => {
    const rejectOnAbort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (options.signal.aborted) rejectOnAbort();
    else options.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
}

test('declared underscore submission types map to explicit runtime contracts', () => {
  assert.equal(
    normalizeMiniAppSubmission({ type: 'service_request' }).path,
    '/v1/intake/service-request'
  );
  assert.equal(
    normalizeMiniAppSubmission({
      type: 'generator_lead',
      coverage: 'managed',
      totalLoadWatts: 9000
    }).path,
    '/v1/intake/generator-lead'
  );
  const maintenance = normalizeMiniAppSubmission({
    type: 'maintenance_booking',
    serviceCode: 'GEN_BATT',
    generatorModel: '22kW'
  });
  assert.equal(maintenance.path, '/v1/intake/maintenance');
  assert.equal(maintenance.body.service_key, 'battery');
  assert.equal(maintenance.body.model, '22kW');
});

test('legacy hyphenated generator type remains compatible', () => {
  const normalized = normalizeMiniAppSubmission({
    type: 'generator-lead',
    coverage: 'essential'
  });
  assert.equal(normalized.type, 'generator_lead');
  assert.equal(normalized.path, '/v1/intake/generator-lead');
  assert.equal(normalized.body.coverage, 'essentials');
});

test('quote requests fail explicitly instead of falling through to service intake', async () => {
  let called = false;
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'quote_request' },
      {
        runtime: { baseUrl: 'http://runtime.test' },
        fetchImpl: async () => {
          called = true;
          return jsonResponse({});
        }
      }
    ),
    (error) => error.status === 400 && /not supported/.test(error.message)
  );
  assert.equal(called, false);
});

test('forwarder sends configured auth, omits empty init data, and normalizes payload', async () => {
  let request;
  const forwarded = await forwardMiniAppSubmission(
    {
      type: 'service_request',
      name: 'Test Customer',
      phone: '555-0100',
      property: 'commercial',
      notes: 'panel'
    },
    {
      runtime: {
        baseUrl: 'http://runtime.test/',
        token: 'runtime-test-token',
        timeoutMs: 1000
      },
      requestId: 'request-16',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return jsonResponse({ receipt_id: 'receipt-16', internal: 'do-not-return' });
      }
    }
  );

  assert.equal(request.url, 'http://runtime.test/v1/intake/service-request');
  assert.equal(request.options.headers['X-Phoenix-Token'], 'runtime-test-token');
  assert.equal(request.options.headers['X-Request-Id'], 'request-16');
  assert.equal('X-Telegram-Init-Data' in request.options.headers, false);
  assert.deepEqual(JSON.parse(request.options.body), {
    category: '',
    urgency: 'flexible',
    property_type: 'commercial',
    description: 'panel',
    name: 'Test Customer',
    phone: '555-0100',
    address: null
  });
  assert.equal(forwarded.result.receipt_id, 'receipt-16');
});

test('forwarder passes nonempty Telegram init data without inventing auth headers', async () => {
  let headers;
  await forwardMiniAppSubmission(
    { type: 'service_request' },
    {
      runtime: { baseUrl: 'http://runtime.test', token: '' },
      initData: 'telegram-init',
      fetchImpl: async (_url, options) => {
        headers = options.headers;
        return jsonResponse({ status: 'accepted' });
      }
    }
  );
  assert.equal(headers['X-Telegram-Init-Data'], 'telegram-init');
  assert.equal('X-Phoenix-Token' in headers, false);
});

test('upstream 4xx status is preserved and upstream 5xx becomes 502', async () => {
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: { baseUrl: 'http://runtime.test' },
        fetchImpl: async () => jsonResponse({ error: 'private detail' }, 422)
      }
    ),
    (error) => error.status === 422 && error.message === 'Submission rejected'
  );
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: { baseUrl: 'http://runtime.test' },
        fetchImpl: async () => jsonResponse({ error: 'private detail' }, 503)
      }
    ),
    (error) => error.status === 502 && error.message === 'Backend rejected submission'
  );
});

test('rejected upstream response bodies are cancelled before returning', async () => {
  let cancelled = false;
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: { baseUrl: 'http://runtime.test' },
        fetchImpl: async () => ({
          ok: false,
          status: 422,
          body: {
            async cancel() {
              cancelled = true;
            }
          }
        })
      }
    ),
    (error) => error.status === 422
  );
  assert.equal(cancelled, true);
});

test('credentialed forwarding refuses automatic redirects', async () => {
  let redirectMode;
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: {
          baseUrl: 'http://runtime.test',
          token: 'runtime-test-token'
        },
        initData: 'telegram-init',
        fetchImpl: async (_url, options) => {
          redirectMode = options.redirect;
          return new Response(null, {
            status: 307,
            headers: { Location: 'https://untrusted.example/collect' }
          });
        }
      }
    ),
    (error) => error.status === 502
  );
  assert.equal(redirectMode, 'manual');
});

test('malformed successful JSON is an upstream failure', async () => {
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: { baseUrl: 'http://runtime.test' },
        fetchImpl: async () => new Response('not-json', { status: 200 })
      }
    ),
    (error) => error.status === 502 && error.message === 'Backend returned an invalid response'
  );
});

test('runtime timeout aborts the upstream request', async () => {
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: { baseUrl: 'http://runtime.test', timeoutMs: 10 },
        fetchImpl: abortableFetch
      }
    ),
    (error) => error.code === 'UPSTREAM_TIMEOUT' && error.status === 502
  );
});

test('runtime timeout while parsing a successful body stays a timeout', async () => {
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: { baseUrl: 'http://runtime.test', timeoutMs: 10 },
        fetchImpl: async (_url, options) => ({
          ok: true,
          status: 200,
          json() {
            return new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                const error = new Error('aborted while reading body');
                error.name = 'AbortError';
                reject(error);
              }, { once: true });
            });
          }
        })
      }
    ),
    (error) => error.code === 'UPSTREAM_TIMEOUT' && error.status === 502
  );
});

test('network failure is logged with request ID but returned as a sanitized error', async () => {
  const originalError = console.error;
  const lines = [];
  console.error = (line) => lines.push(String(line));
  try {
    await assert.rejects(
      forwardMiniAppSubmission(
        { type: 'service_request' },
        {
          runtime: { baseUrl: 'http://runtime.test' },
          requestId: 'request-network-failure',
          fetchImpl: async () => {
            throw new Error('getaddrinfo ENOTFOUND runtime.internal');
          }
        }
      ),
      (error) => (
        error.message === 'Backend unreachable'
        && !error.message.includes('ENOTFOUND')
      )
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(lines.some((line) => (
    line.includes('getaddrinfo ENOTFOUND runtime.internal')
    && line.includes('request-network-failure')
  )), true);
});

test('forwarder rejects an unbounded timeout configuration', async () => {
  await assert.rejects(
    forwardMiniAppSubmission(
      { type: 'service_request' },
      {
        runtime: { baseUrl: 'http://runtime.test', timeoutMs: 120001 },
        fetchImpl: async () => jsonResponse({})
      }
    ),
    (error) => error.code === 'MISCONFIGURED' && error.status === 503
  );
});

test('caller cancellation aborts the upstream request', async () => {
  const controller = new AbortController();
  const pending = forwardMiniAppSubmission(
    { type: 'service_request' },
    {
      runtime: { baseUrl: 'http://runtime.test', timeoutMs: 1000 },
      signal: controller.signal,
      fetchImpl: abortableFetch
    }
  );
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error.code === 'CLIENT_ABORTED' && error.status === 499
  );
});

test('public receipt allowlist excludes upstream internals and customer data', () => {
  assert.deepEqual(
    publicRuntimeReceipt({
      id: 'lead-16',
      status: 'accepted',
      customer_phone: '555-0100',
      debug: { stack: 'private' },
      receipt: {
        receipt_id: 'receipt-16',
        internal_path: '/private/path'
      }
    }),
    {
      id: 'lead-16',
      status: 'accepted',
      receipt_id: 'receipt-16'
    }
  );
});

test('HTTP response returns only the allowlisted runtime receipt', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    }
  };
  registerMiniAppRoutes(app, {
    runtime: () => ({
      baseUrl: 'http://runtime.test',
      token: 'runtime-test-token'
    }),
    fetchImpl: async () => jsonResponse({
      receipt_id: 'receipt-16',
      customer_phone: '555-0100',
      debug: { internal: true }
    })
  });

  const req = new EventEmitter();
  req.body = { type: 'service_request' };
  req.requestId = 'request-16';
  req.get = () => '';
  req.aborted = false;

  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function json(body) {
    this.body = body;
    this.writableEnded = true;
    return this;
  };

  await routes.get('POST /api/miniapp/submit')(req, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.error, null);
  assert.deepEqual(res.body.data, {
    received: true,
    type: 'service_request',
    receipt: { receipt_id: 'receipt-16' }
  });
  assert.equal(JSON.stringify(res.body).includes('customer_phone'), false);
  assert.equal(JSON.stringify(res.body).includes('debug'), false);
});

test('HTTP forwarding failures use the canonical response envelope', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    get() {}
  };
  registerMiniAppRoutes(app, {
    runtime: { baseUrl: '' }
  });

  const req = new EventEmitter();
  req.body = { type: 'service_request' };
  req.requestId = 'request-failure';
  req.get = () => 'telegram-init';
  req.aborted = false;

  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function json(body) {
    this.body = body;
    this.writableEnded = true;
    return this;
  };

  await routes.get('POST /api/miniapp/submit')(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error, 'Backend not configured');
  assert.equal(res.body.requestId, 'request-failure');
  assert.equal(Number.isNaN(Date.parse(res.body.timestamp)), false);
});

test('already-disconnected HTTP requests never start runtime forwarding', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    get() {}
  };
  let fetchCalled = false;
  registerMiniAppRoutes(app, {
    runtime: { baseUrl: 'http://runtime.test' },
    fetchImpl: async () => {
      fetchCalled = true;
      return jsonResponse({});
    }
  });

  const req = new EventEmitter();
  req.body = { type: 'service_request' };
  req.requestId = 'request-already-aborted';
  req.get = () => 'telegram-init';
  req.aborted = true;

  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.status = function status() {
    assert.fail('must not write after a prior disconnect');
  };
  res.json = function json() {
    assert.fail('must not write after a prior disconnect');
  };

  await routes.get('POST /api/miniapp/submit')(req, res);
  assert.equal(fetchCalled, false);
});

test('HTTP client disconnect aborts forwarding without writing a response', async () => {
  const routes = new Map();
  const app = {
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    get() {}
  };
  registerMiniAppRoutes(app, {
    runtime: { baseUrl: 'http://runtime.test', timeoutMs: 1000 },
    fetchImpl: abortableFetch
  });

  const req = new EventEmitter();
  req.body = { type: 'service_request' };
  req.requestId = 'request-disconnect';
  req.get = () => '';
  req.aborted = false;

  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.status = function status() {
    assert.fail('response status must not be written after disconnect');
  };
  res.json = function json() {
    assert.fail('response body must not be written after disconnect');
  };

  const pending = routes.get('POST /api/miniapp/submit')(req, res);
  req.aborted = true;
  req.emit('aborted');
  await pending;
});
