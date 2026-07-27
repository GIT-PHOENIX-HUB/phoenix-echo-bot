import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

const ENV_KEYS = [
  'PHOENIX_CONFIG_PATH',
  'PHOENIX_RUNTIME_URL',
  'PHOENIX_RUNTIME_WS_URL',
  'PHOENIX_RUNTIME_TOKEN',
  'PHOENIX_RUNTIME_TIMEOUT_MS',
  'TEST_RUNTIME_TOKEN'
];

async function withEnv(values, fn) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('runtime environment variables override and normalize runtime configuration', { concurrency: false }, async () => {
  await withEnv({
    PHOENIX_CONFIG_PATH: join(tmpdir(), 'phoenix-echo-pr16-missing-config.json'),
    PHOENIX_RUNTIME_URL: ' https://runtime.example.test/// ',
    PHOENIX_RUNTIME_WS_URL: ' wss://runtime.example.test/ws ',
    PHOENIX_RUNTIME_TOKEN: ' runtime-test-token ',
    PHOENIX_RUNTIME_TIMEOUT_MS: '2750'
  }, async () => {
    const { config } = await loadConfig();
    assert.deepEqual(config.runtime, {
      baseUrl: 'https://runtime.example.test',
      wsUrl: 'wss://runtime.example.test/ws',
      token: 'runtime-test-token',
      timeoutMs: 2750
    });
  });
});

test('runtime token supports env references from the config file', { concurrency: false }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-echo-pr16-'));
  const configPath = join(directory, 'config.json');
  try {
    await writeFile(configPath, JSON.stringify({
      runtime: {
        baseUrl: 'http://runtime.internal///',
        token: 'env:TEST_RUNTIME_TOKEN',
        timeoutMs: 1250
      }
    }));
    await withEnv({
      PHOENIX_CONFIG_PATH: configPath,
      TEST_RUNTIME_TOKEN: 'referenced-test-token'
    }, async () => {
      const { config } = await loadConfig();
      assert.equal(config.runtime.baseUrl, 'http://runtime.internal');
      assert.equal(config.runtime.token, 'referenced-test-token');
      assert.equal(config.runtime.timeoutMs, 1250);
    });
  } finally {
    const archive = join(tmpdir(), '_ARCHIVE');
    await mkdir(archive, { recursive: true });
    await rename(directory, join(archive, basename(directory)));
  }
});

test('invalid runtime timeout fails configuration loading', { concurrency: false }, async () => {
  await withEnv({
    PHOENIX_CONFIG_PATH: join(tmpdir(), 'phoenix-echo-pr16-missing-config.json'),
    PHOENIX_RUNTIME_TIMEOUT_MS: 'not-a-number'
  }, async () => {
    await assert.rejects(loadConfig(), /Invalid runtime timeout: not-a-number/);
  });
});

test('runtime timeout cannot exceed the bounded maximum', { concurrency: false }, async () => {
  await withEnv({
    PHOENIX_CONFIG_PATH: join(tmpdir(), 'phoenix-echo-pr16-missing-config.json'),
    PHOENIX_RUNTIME_TIMEOUT_MS: '120001'
  }, async () => {
    await assert.rejects(loadConfig(), /Invalid runtime timeout: 120001/);
  });
});
