import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';

import { hasIndependentAuthentication } from '../src/http-auth.js';
import { loadConfig } from '../src/config.js';
import { persistTelegramMiniAppFallback } from '../src/miniapp-fallback.js';
import {
  configuredMiniAppOrigin,
  forwardMiniAppSubmission,
  normalizeMiniAppSubmission,
  registerMiniAppRoutes
} from '../src/miniapp-routes.js';

test('only independently authenticated endpoints bypass the gateway token', () => {
  const enabled = { teamsRouteEnabled: true, miniAppSubmitEnabled: true };
  assert.equal(hasIndependentAuthentication('POST', '/messages', enabled), true);
  assert.equal(hasIndependentAuthentication('POST', '/miniapp/submit', enabled), true);
  assert.equal(hasIndependentAuthentication('OPTIONS', '/miniapp/submit', enabled), true);
  assert.equal(hasIndependentAuthentication('GET', '/miniapp/submit', enabled), false);
  assert.equal(hasIndependentAuthentication('POST', '/miniapp/chat', enabled), false);
  assert.equal(
    hasIndependentAuthentication('POST', '/miniapp/submit', {
      ...enabled,
      miniAppSubmitEnabled: false
    }),
    false
  );
});

test('advertised runtime and Mini App environment settings reach loaded config', async () => {
  const keys = [
    'PHOENIX_CONFIG_PATH',
    'PHOENIX_RUNTIME_URL',
    'PHOENIX_RUNTIME_TIMEOUT_MS',
    'PHOENIX_TELEGRAM_MINIAPP_URL',
    'PHOENIX_MINIAPP_ENABLED',
    'PHOENIX_MINIAPP_ALLOWED_ORIGIN'
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    PHOENIX_CONFIG_PATH: '/tmp/phoenix-echo-review-no-config.json',
    PHOENIX_RUNTIME_URL: 'http://runtime.example:9120/',
    PHOENIX_RUNTIME_TIMEOUT_MS: '4321',
    PHOENIX_TELEGRAM_MINIAPP_URL: 'https://miniapp.example/app',
    PHOENIX_MINIAPP_ENABLED: 'true',
    PHOENIX_MINIAPP_ALLOWED_ORIGIN: 'https://miniapp.example'
  });
  try {
    const { config } = await loadConfig({ projectRoot: '/tmp/phoenix-echo-review' });
    assert.equal(config.runtime.baseUrl, 'http://runtime.example:9120');
    assert.equal(config.runtime.timeoutMs, 4321);
    assert.equal(config.channels.telegram.miniAppUrl, 'https://miniapp.example/app');
    assert.equal(config.channels.miniApp.enabled, true);
    assert.equal(config.channels.miniApp.allowedOrigin, 'https://miniapp.example');
  } finally {
    for (const key of keys) {
      if (before[key] == null) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('live Mini App types and fields translate to exact runtime intake contracts', () => {
  assert.deepEqual(normalizeMiniAppSubmission({
    type: 'service_request',
    category: 'panel',
    urgency: 'this_week',
    property: 'commercial',
    notes: 'Upgrade',
    name: 'A',
    phone: '1'
  }), {
    type: 'service_request',
    path: '/v1/intake/service-request',
    body: {
      category: 'panel',
      urgency: 'this_week',
      property_type: 'commercial',
      description: 'Upgrade',
      name: 'A',
      phone: '1',
      address: null
    }
  });

  const generator = normalizeMiniAppSubmission({
    type: 'generator_lead',
    sqft: 2400,
    totalLoadWatts: 18000,
    coverage: 'managed',
    name: 'B',
    phone: '2'
  });
  assert.equal(generator.path, '/v1/intake/generator-lead');
  assert.deepEqual(generator.body, {
    sqft: 2400,
    load_watts: 18000,
    coverage: 'managed_whole_home',
    name: 'B',
    phone: '2'
  });

  const maintenance = normalizeMiniAppSubmission({
    type: 'maintenance_request',
    serviceCode: 'GEN_MAINT',
    name: 'C',
    phone: '3',
    generatorModel: 'Guardian'
  });
  assert.equal(maintenance.path, '/v1/intake/maintenance');
  assert.equal(maintenance.body.service_key, 'annual');
  assert.equal(maintenance.body.model, 'Guardian');

  assert.throws(() => normalizeMiniAppSubmission({ type: 'unknown' }), /Unsupported/);
  assert.throws(() => normalizeMiniAppSubmission({ type: 'quote_request' }), /not supported/);
});

test('unsupported submit types are classified as client errors before backend access', async () => {
  await assert.rejects(
    forwardMiniAppSubmission({ type: 'unknown' }, {
      runtime: { baseUrl: '', timeoutMs: 100 }
    }),
    (error) => error.status === 400 && /Unsupported/.test(error.message)
  );
});

test('runtime forwarding carries correlation/auth headers and translated body', async () => {
  let captured;
  const result = await forwardMiniAppSubmission({
    type: 'service_request',
    category: 'lighting',
    property: 'residential',
    name: 'A',
    phone: '1'
  }, {
    runtime: { baseUrl: 'http://127.0.0.1:9120/', timeoutMs: 100 },
    initData: 'telegram-init-data',
    requestId: 'request-123',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        async json() {
          return { queued: true };
        }
      };
    }
  });

  assert.equal(captured.url, 'http://127.0.0.1:9120/v1/intake/service-request');
  assert.equal(captured.options.headers['X-Telegram-Init-Data'], 'telegram-init-data');
  assert.equal(captured.options.headers['X-Request-Id'], 'request-123');
  assert.equal(JSON.parse(captured.options.body).property_type, 'residential');
  assert.deepEqual(result.result, { queued: true });
});

test('runtime forwarding aborts at the configured timeout', async () => {
  await assert.rejects(
    forwardMiniAppSubmission({
      type: 'service_request',
      category: 'lighting',
      name: 'A',
      phone: '1'
    }, {
      runtime: { baseUrl: 'http://127.0.0.1:9120', timeoutMs: 5 },
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    }),
    /Backend timeout/
  );
});

test('runtime client errors remain client errors', async () => {
  await assert.rejects(
    forwardMiniAppSubmission({
      type: 'service_request',
      category: 'lighting',
      name: 'A',
      phone: '1'
    }, {
      runtime: { baseUrl: 'http://127.0.0.1:9120', timeoutMs: 100 },
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        async text() {
          return 'missing required field';
        }
      })
    }),
    (error) => error.status === 422 && error.message === 'Submission rejected'
  );
});

test('configured Mini App CORS allows only one absolute HTTP(S) origin', () => {
  assert.equal(
    configuredMiniAppOrigin('https://echo.phoenixelectric.life/miniapp'),
    'https://echo.phoenixelectric.life'
  );
  assert.equal(configuredMiniAppOrigin(''), '');
  assert.throws(() => configuredMiniAppOrigin('file:///tmp/app'), /HTTP/);
  assert.throws(() => configuredMiniAppOrigin('not-a-url'), /absolute/);

  const routes = {};
  const app = {
    options(path, handler) {
      routes[`OPTIONS ${path}`] = handler;
    },
    post() {},
    get() {}
  };
  registerMiniAppRoutes(app, {
    miniApp: { allowedOrigin: 'https://miniapp.example/path' }
  });

  const response = {
    headers: {},
    statusCode: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
  routes['OPTIONS /api/miniapp/submit']({
    requestId: 'req',
    get(name) {
      return name === 'Origin' ? 'https://miniapp.example' : '';
    }
  }, response);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://miniapp.example');

  const rejected = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader() {}
  };
  routes['OPTIONS /api/miniapp/submit']({
    requestId: 'req-2',
    get(name) {
      return name === 'Origin' ? 'https://attacker.example' : '';
    }
  }, rejected);
  assert.equal(rejected.statusCode, 403);
  assert.match(rejected.body.error, /not allowed/);
});

test('blank Mini App allowlist permits only the request same-origin and reloads dynamically', () => {
  const routes = {};
  let currentConfig = { allowedOrigin: '' };
  const app = {
    options(path, handler) {
      routes[`OPTIONS ${path}`] = handler;
    },
    post() {},
    get() {}
  };
  registerMiniAppRoutes(app, {
    miniApp: () => currentConfig
  });

  const response = () => ({
    headers: {},
    statusCode: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  });
  const request = (origin) => ({
    protocol: 'https',
    requestId: 'req',
    get(name) {
      if (name === 'Origin') return origin;
      if (name === 'Host') return 'echo.example';
      return '';
    }
  });

  const sameOrigin = response();
  routes['OPTIONS /api/miniapp/submit'](request('https://echo.example'), sameOrigin);
  assert.equal(sameOrigin.statusCode, 204);
  assert.equal(sameOrigin.headers['Access-Control-Allow-Origin'], 'https://echo.example');

  const crossOrigin = response();
  routes['OPTIONS /api/miniapp/submit'](request('https://attacker.example'), crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);

  currentConfig = { allowedOrigin: 'https://new.example/app' };
  const reloadedOrigin = response();
  routes['OPTIONS /api/miniapp/submit'](request('https://new.example'), reloadedOrigin);
  assert.equal(reloadedOrigin.statusCode, 204);
  assert.equal(reloadedOrigin.headers['Access-Control-Allow-Origin'], 'https://new.example');
});

test('registered submit route forwards a translated request across the live HTTP boundary', async (t) => {
  let upstreamRequest;
  const runtimeServer = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamRequest = {
        url: req.url,
        requestId: req.headers['x-request-id'],
        initData: req.headers['x-telegram-init-data'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"queued":true}');
    });
  });
  await new Promise((resolve) => runtimeServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => runtimeServer.close(resolve)));
  const runtimePort = runtimeServer.address().port;

  const app = express();
  app.use((req, _res, next) => {
    req.requestId = 'integration-request';
    next();
  });
  app.use(express.json());
  registerMiniAppRoutes(app, {
    runtime: {
      baseUrl: `http://127.0.0.1:${runtimePort}`,
      timeoutMs: 500
    },
    miniApp: {
      allowedOrigin: 'https://miniapp.example/app'
    }
  });
  const gatewayServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => gatewayServer.once('listening', resolve));
  t.after(() => new Promise((resolve) => gatewayServer.close(resolve)));
  const gatewayPort = gatewayServer.address().port;

  const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/miniapp/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://miniapp.example',
      'X-Telegram-Init-Data': 'signed-init-data'
    },
    body: JSON.stringify({
      type: 'service_request',
      category: 'panel',
      property: 'commercial',
      name: 'Customer',
      phone: '555'
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://miniapp.example');
  assert.equal(upstreamRequest.url, '/v1/intake/service-request');
  assert.equal(upstreamRequest.requestId, 'integration-request');
  assert.equal(upstreamRequest.initData, 'signed-init-data');
  assert.equal(upstreamRequest.body.property_type, 'commercial');
});

test('Telegram sendData fallback is normalized and appended durably', async () => {
  const writes = [];
  const result = await persistTelegramMiniAppFallback({
    async append(sessionId, entry) {
      writes.push({ sessionId, entry });
    }
  }, {
    data: JSON.stringify({
      type: 'maintenance_request',
      serviceCode: 'GEN_BATT',
      name: 'Customer',
      phone: '555',
      generatorModel: 'Guardian'
    }),
    chatId: '123',
    userId: '456'
  });

  assert.equal(result.sessionId, 'miniapp-fallback-123');
  assert.equal(result.type, 'maintenance_request');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].entry.type, 'miniapp_fallback');
  assert.match(writes[0].entry.content, /\"service_key\":\"battery\"/);
  await assert.rejects(
    persistTelegramMiniAppFallback({ append: async () => {} }, {
      data: 'not-json',
      chatId: '123'
    }),
    /valid JSON/
  );
});

test('channel runbooks describe only active registrations and exact rollback paths', async () => {
  const telegram = await readFile(
    new URL('../runbooks/channels/TELEGRAM.md', import.meta.url),
    'utf8'
  );
  const teams = await readFile(
    new URL('../runbooks/channels/TEAMS.md', import.meta.url),
    'utf8'
  );
  const whatsapp = await readFile(
    new URL('../runbooks/channels/WHATSAPP.md', import.meta.url),
    'utf8'
  );
  const overview = await readFile(
    new URL('../runbooks/channels/README.md', import.meta.url),
    'utf8'
  );
  const token = await readFile(
    new URL('../runbooks/ROTATE-GATEWAY-TOKEN.md', import.meta.url),
    'utf8'
  );

  assert.match(telegram, /src\/adapters\/telegram-adapter\.js/);
  assert.match(telegram, /localhost:18790\/health/);
  assert.match(teams, /src\/adapters\/teams-adapter\.js/);
  assert.match(teams, /PHOENIX_TEAMS_APP_TENANT_ID/);
  assert.match(whatsapp, /UNWIRED SCAFFOLD/);
  assert.match(overview, /Mini App HTTP routes/);
  assert.match(token, /authorized operator/);
  assert.match(token, /api\/channels\/status/);
  assert.doesNotMatch(token, /api\/miniapp\/products/);
  assert.doesNotMatch(token, /Any seat/);
});
