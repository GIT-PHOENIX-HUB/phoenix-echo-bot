import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TelegramAdapter } from '../src/adapters/telegram-adapter.js';

class FakeBot {
  constructor() {
    this.handlers = new Map();
    this.sent = [];
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  async sendMessage(chatId, text, options = {}) {
    this.sent.push({ chatId, text, options });
  }
}

test('Telegram consumes web_app_data through the durable fallback handler', async () => {
  const bot = new FakeBot();
  const fallback = [];
  new TelegramAdapter({
    botToken: 'test',
    miniAppUrl: 'https://miniapp.example/app'
  }, async () => '', {
    bot,
    async webAppDataHandler(message) {
      fallback.push(message);
      return { type: 'service_request', sessionId: 'miniapp-fallback-123' };
    }
  });

  await bot.handlers.get('message')({
    chat: { id: 123 },
    from: { id: 456, first_name: 'Customer' },
    web_app_data: { data: '{"type":"service_request"}' }
  });

  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].chatId, '123');
  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0].text, /received your request/i);
});

test('Telegram slash commands open the configured Mini App URL', async () => {
  const bot = new FakeBot();
  new TelegramAdapter({
    botToken: 'test',
    miniAppUrl: 'https://miniapp.example/app'
  }, async () => '', { bot });

  await bot.handlers.get('message')({
    chat: { id: 123 },
    from: { id: 456, first_name: 'Customer' },
    text: '/service'
  });

  assert.equal(bot.sent.length, 1);
  assert.equal(
    bot.sent[0].options.reply_markup.keyboard[0][0].web_app.url,
    'https://miniapp.example/app?startapp=service'
  );
});

test('Telegram launcher preserves existing URL query and fragment components', async () => {
  const bot = new FakeBot();
  new TelegramAdapter({
    botToken: 'test',
    miniAppUrl: 'https://miniapp.example/app?v=2#form'
  }, async () => '', { bot });

  await bot.handlers.get('message')({
    chat: { id: 123 },
    from: { id: 456, first_name: 'Customer' },
    text: '/service'
  });

  assert.equal(
    bot.sent[0].options.reply_markup.keyboard[0][0].web_app.url,
    'https://miniapp.example/app?v=2&startapp=service#form'
  );
});

test('Telegram reply-keyboard launch can deliver web_app_data fallback', async () => {
  const bot = new FakeBot();
  new TelegramAdapter({
    botToken: 'test',
    miniAppUrl: 'https://miniapp.example/app'
  }, async () => '', { bot });

  await bot.handlers.get('message')({
    chat: { id: 123 },
    from: { id: 456, first_name: 'Customer' },
    text: '/generator'
  });

  const markup = bot.sent[0].options.reply_markup;
  assert.equal(markup.inline_keyboard, undefined);
  assert.equal(markup.keyboard[0][0].web_app.url, 'https://miniapp.example/app?startapp=generator');
  assert.equal(markup.one_time_keyboard, true);
});

test('text-only Telegram commands work without a Mini App URL', async () => {
  const bot = new FakeBot();
  new TelegramAdapter({
    botToken: 'test',
    miniAppUrl: ''
  }, async () => '', { bot });

  await bot.handlers.get('message')({
    chat: { id: 123 },
    from: { id: 456, first_name: 'Customer' },
    text: '/help'
  });
  await bot.handlers.get('message')({
    chat: { id: 123 },
    from: { id: 456, first_name: 'Customer' },
    text: '/terms'
  });
  await bot.handlers.get('message')({
    chat: { id: 123 },
    from: { id: 456, first_name: 'Customer' },
    text: '/service'
  });

  assert.match(bot.sent[0].text, /Commands:/);
  assert.match(bot.sent[1].text, /estimates/i);
  assert.match(bot.sent[2].text, /temporarily unavailable/i);
});
