import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildTelegramPollingOptions } from '../src/adapters/telegram-adapter.js';
import {
  evaluateWhatsAppInbound,
  normalizeWhatsAppGroupIds
} from '../src/channels/whatsapp-policy.js';
import { loadConfig } from '../src/config.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function text(relativePath) {
  return readFile(join(ROOT, relativePath), 'utf8');
}

test('channel flags control WhatsApp startup and Mini App route registration', async () => {
  const source = await text('src/index.js');

  assert.match(source, /import \{ createWhatsAppChannel \} from '\.\/channels\/whatsapp\.js';/);
  assert.match(source, /if \(whatsappConfig\.enabled\)/);
  assert.match(source, /const whatsappChannel = createWhatsAppChannel\(whatsappConfig/);
  assert.doesNotMatch(source, /await createWhatsAppChannel\(whatsappConfig/);
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
  const previousAllowedGroups = process.env.PHOENIX_WHATSAPP_ALLOWED_GROUP_IDS;

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
    process.env.PHOENIX_WHATSAPP_ALLOWED_GROUP_IDS =
      '120363000000000000@g.us, 120363111111111111@g.us, 120363000000000000@g.us';

    const result = await loadConfig({ projectRoot: ROOT });
    assert.equal(result.config.channels.miniApp.enabled, false);
    assert.equal(result.config.channels.whatsapp.enabled, true);
    assert.deepEqual(result.config.channels.whatsapp.allowedGroupIds, [
      '120363000000000000@g.us',
      '120363111111111111@g.us'
    ]);
    assert.equal(result.configPath, configPath);
  } finally {
    if (previousPath === undefined) delete process.env.PHOENIX_CONFIG_PATH;
    else process.env.PHOENIX_CONFIG_PATH = previousPath;
    if (previousWhatsApp === undefined) delete process.env.PHOENIX_WHATSAPP_ENABLED;
    else process.env.PHOENIX_WHATSAPP_ENABLED = previousWhatsApp;
    if (previousAllowedGroups === undefined) {
      delete process.env.PHOENIX_WHATSAPP_ALLOWED_GROUP_IDS;
    } else {
      process.env.PHOENIX_WHATSAPP_ALLOWED_GROUP_IDS = previousAllowedGroups;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('WhatsApp inbound policy requires text and explicit group allowlisting', () => {
  assert.deepEqual(normalizeWhatsAppGroupIds('group-a@g.us, group-b@g.us, group-a@g.us'), [
    'group-a@g.us',
    'group-b@g.us'
  ]);
  assert.deepEqual(
    evaluateWhatsAppInbound(
      { chatId: 'customer@c.us', isGroup: false, body: '  Need service  ' },
      []
    ),
    { accepted: true, text: 'Need service' }
  );
  assert.deepEqual(
    evaluateWhatsAppInbound(
      { chatId: 'customer@c.us', isGroup: false, body: '', hasMedia: true },
      []
    ),
    { accepted: false, reason: 'unsupported_or_empty_content' }
  );
  assert.deepEqual(
    evaluateWhatsAppInbound(
      { chatId: 'group-a@g.us', isGroup: true, body: 'private group message' },
      []
    ),
    { accepted: false, reason: 'group_not_allowed' }
  );
  assert.deepEqual(
    evaluateWhatsAppInbound(
      { chatId: 'group-a@g.us', isGroup: true, body: 'approved group message' },
      ['group-a@g.us']
    ),
    { accepted: true, text: 'approved group message' }
  );
});

test('the live Telegram adapter applies its configured polling interval', () => {
  assert.deepEqual(buildTelegramPollingOptions({ pollIntervalMs: 725 }), {
    polling: {
      interval: 725,
      params: { timeout: 30 }
    },
    request: { timeout: 45000 }
  });
  assert.equal(buildTelegramPollingOptions({ pollIntervalMs: 10 }).polling.interval, 100);
  assert.equal(buildTelegramPollingOptions({ pollIntervalMs: 'invalid' }).polling.interval, 300);
});

test('operator runbooks name the live surfaces and executable verification paths', async () => {
  const [overview, whatsapp, miniApp, teams, telegram, commandApp, outlook, envExample] =
    await Promise.all([
    text('runbooks/channels/README.md'),
    text('runbooks/channels/WHATSAPP.md'),
    text('runbooks/channels/MINI-APP.md'),
    text('runbooks/channels/TEAMS.md'),
    text('runbooks/channels/TELEGRAM.md'),
    text('runbooks/channels/COMMAND-APP.md'),
    text('runbooks/channels/OUTLOOK.md'),
    text('.env.example')
  ]);
  const combined = [
    overview,
    whatsapp,
    miniApp,
    teams,
    telegram,
    commandApp,
    outlook,
    envExample
  ].join('\n');

  assert.match(overview, /startup log entry `Phoenix Echo Gateway starting` records the resolved `configPath`/);
  assert.match(whatsapp, /`src\/index\.js` starts and registers `src\/channels\/whatsapp\.js`/);
  assert.match(whatsapp, /Group messages are rejected by default/);
  assert.match(whatsapp, /PHOENIX_WHATSAPP_ALLOWED_GROUP_IDS/);
  assert.match(miniApp, /X-Phoenix-Token: \$PHOENIX_GATEWAY_TOKEN/);
  assert.match(teams, /`src\/adapters\/teams-adapter\.js`/);
  assert.match(teams, /PHOENIX_TEAMS_APP_TENANT_ID/);
  assert.match(teams, /not enforced by the live adapter/);
  assert.match(telegram, /`src\/adapters\/telegram-adapter\.js`/);
  assert.match(telegram, /configure the bot's menu button \/ Web App URL in BotFather/);
  assert.match(telegram, /localhost:18790\/health/);
  assert.match(commandApp, /does not read `channels\.commandApp\.enabled`/);
  assert.match(outlook, /does not read `channels\.outlook\.enabled`/);

  assert.doesNotMatch(combined, /PHOENIX_TEAMS_TENANT_ID/);
  assert.doesNotMatch(combined, /PHOENIX_TELEGRAM_MINIAPP_URL/);
  assert.doesNotMatch(telegram, /localhost:18790\/healthz/);
  assert.doesNotMatch(commandApp, /Enabling logs one init line/);
  assert.doesNotMatch(outlook, /enabling logs `\[Outlook\] Channel initialized`/);
});
