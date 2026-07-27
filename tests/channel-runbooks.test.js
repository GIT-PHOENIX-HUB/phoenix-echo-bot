import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildTelegramPollingOptions } from '../src/adapters/telegram-adapter.js';
import { loadConfig } from '../src/config.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function text(relativePath) {
  return readFile(join(ROOT, relativePath), 'utf8');
}

test('channel flags control WhatsApp startup and Mini App route registration', async () => {
  const source = await text('src/index.js');

  assert.match(source, /import \{ createWhatsAppChannel \} from '\.\/channels\/whatsapp\.js';/);
  assert.match(source, /if \(whatsappConfig\.enabled\)/);
  assert.match(source, /await createWhatsAppChannel\(whatsappConfig/);
  assert.match(source, /messageRouter\.registerAdapter\('whatsapp', whatsappChannel\)/);
  assert.match(source, /handleMessage\(sessionId, message\.body,/);

  assert.match(source, /if \(config\.channels\?\.miniApp\?\.enabled\)/);
  assert.match(source, /registerMiniAppRoutes\(app,/);
  assert.match(source, /MiniApp routes disabled in config/);
});

test('config keeps Mini App rollback explicit and honors the documented WhatsApp env flag', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-channel-config-'));
  const configPath = join(directory, 'config.json');
  const previousPath = process.env.PHOENIX_CONFIG_PATH;
  const previousWhatsApp = process.env.PHOENIX_WHATSAPP_ENABLED;

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        channels: {
          miniApp: { enabled: false },
          whatsapp: { enabled: false }
        }
      })
    );
    process.env.PHOENIX_CONFIG_PATH = configPath;
    process.env.PHOENIX_WHATSAPP_ENABLED = 'true';

    const result = await loadConfig({ projectRoot: ROOT });
    assert.equal(result.config.channels.miniApp.enabled, false);
    assert.equal(result.config.channels.whatsapp.enabled, true);
    assert.equal(result.configPath, configPath);
  } finally {
    if (previousPath === undefined) delete process.env.PHOENIX_CONFIG_PATH;
    else process.env.PHOENIX_CONFIG_PATH = previousPath;
    if (previousWhatsApp === undefined) delete process.env.PHOENIX_WHATSAPP_ENABLED;
    else process.env.PHOENIX_WHATSAPP_ENABLED = previousWhatsApp;
    await rm(directory, { recursive: true, force: true });
  }
});

test('the live Telegram adapter applies its configured polling interval', () => {
  assert.deepEqual(buildTelegramPollingOptions({ pollIntervalMs: 725 }), {
    polling: {
      interval: 725,
      params: { timeout: 30 }
    },
    request: { timeout: 30000 }
  });
  assert.equal(buildTelegramPollingOptions({ pollIntervalMs: 10 }).polling.interval, 100);
  assert.equal(buildTelegramPollingOptions({ pollIntervalMs: 'invalid' }).polling.interval, 300);
});

test('operator runbooks name the live surfaces and executable verification paths', async () => {
  const [overview, whatsapp, miniApp, teams, telegram, envExample] = await Promise.all([
    text('runbooks/channels/README.md'),
    text('runbooks/channels/WHATSAPP.md'),
    text('runbooks/channels/MINI-APP.md'),
    text('runbooks/channels/TEAMS.md'),
    text('runbooks/channels/TELEGRAM.md'),
    text('.env.example')
  ]);
  const combined = [overview, whatsapp, miniApp, teams, telegram, envExample].join('\n');

  assert.match(overview, /startup log entry `Phoenix Echo Gateway starting` records the resolved `configPath`/);
  assert.match(whatsapp, /`src\/index\.js` starts and registers `src\/channels\/whatsapp\.js`/);
  assert.match(miniApp, /X-Phoenix-Token: \$PHOENIX_GATEWAY_TOKEN/);
  assert.match(teams, /`src\/adapters\/teams-adapter\.js`/);
  assert.match(teams, /PHOENIX_TEAMS_APP_TENANT_ID/);
  assert.match(telegram, /`src\/adapters\/telegram-adapter\.js`/);
  assert.match(telegram, /configure the bot's menu button \/ Web App URL in BotFather/);
  assert.match(telegram, /localhost:18790\/health/);

  assert.doesNotMatch(combined, /PHOENIX_TEAMS_TENANT_ID/);
  assert.doesNotMatch(combined, /PHOENIX_TELEGRAM_MINIAPP_URL/);
  assert.doesNotMatch(telegram, /localhost:18790\/healthz/);
});
