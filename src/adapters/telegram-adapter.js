/**
 * Phoenix Echo Gateway - Telegram Adapter
 *
 * Handles Telegram bot messaging including voice message transcription.
 * Voice messages: detect → fetch file → Whisper transcribe → route as text → respond.
 */

import TelegramBot from 'node-telegram-bot-api';
import { getDefaultLogger } from '../logger.js';

const logger = getDefaultLogger();

export class TelegramAdapter {
  constructor(config, messageHandler) {
    this.config = config;
    this.messageHandler = messageHandler;
    this.bot = null;
    this.ready = false;

    if (!config.botToken) {
      logger.warn('TelegramAdapter: No botToken, adapter will not start');
      return;
    }

    this.bot = new TelegramBot(config.botToken, { polling: true, request: { timeout: 30000 } });
    this._setupHandlers();
    this.ready = true;
    logger.info('TelegramAdapter initialized', { polling: true });
  }

  _setupHandlers() {
    this.bot.on('message', async (msg) => {
      try {
        if (msg.voice || msg.audio) {
          await this._handleVoiceMessage(msg, msg.audio ? 'audio' : 'voice');
          return;
        }
        if (msg.text && !msg.text.startsWith('/')) {
          await this._handleTextMessage(msg);
        }
      } catch (error) {
        logger.error('Telegram message error', { chatId: msg.chat.id, error: error.message });
        try {
          await this.bot.sendMessage(msg.chat.id, 'Sorry, an error occurred. Please try again.');
        } catch (e) { /* best effort */ }
      }
    });

    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error', { error: error.message });
    });
  }

  async _handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const fromName = msg.from?.first_name || 'Unknown';

    const response = await this.messageHandler({
      text: msg.text,
      chatId: String(chatId),
      fromName,
      source: 'telegram',
      messageType: 'text',
      reply: async (text) => { await this.bot.sendMessage(chatId, text); }
    });

    if (response) await this.bot.sendMessage(chatId, response);
  }

  async _handleVoiceMessage(msg, type = 'voice') {
    const chatId = msg.chat.id;
    const fromName = msg.from?.first_name || 'Unknown';
    const fileId = type === 'audio' ? msg.audio.file_id : msg.voice.file_id;
    const duration = type === 'audio' ? msg.audio.duration : msg.voice.duration;

    logger.info('Voice message received', { chatId, fromName, type, duration });
    await this.bot.sendChatAction(chatId, 'typing');

    try {
      // 1. Get file path from Telegram
      const file = await this.bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;

      // 2. Download audio
      const audioResponse = await fetch(fileUrl);
      if (!audioResponse.ok) throw new Error(`Download failed: ${audioResponse.status}`);
      const audioBuffer = await audioResponse.arrayBuffer();

      // 3. Transcribe via Whisper
      const transcript = await this._transcribeAudio(Buffer.from(audioBuffer), file.file_path);

      if (!transcript || !transcript.trim()) {
        await this.bot.sendMessage(chatId, 'I received your voice message but couldn\'t transcribe any speech. Please try again or type your message.');
        return;
      }

      logger.info('Voice transcribed', { chatId, preview: transcript.substring(0, 80) });

      // 4. Route through same pipeline as typed text
      const response = await this.messageHandler({
        text: transcript,
        chatId: String(chatId),
        fromName,
        source: 'telegram',
        messageType: 'voice',
        voiceDuration: duration,
        reply: async (text) => { await this.bot.sendMessage(chatId, text); }
      });

      // 5. Respond to same chat
      if (response) await this.bot.sendMessage(chatId, response);
    } catch (error) {
      // 6. Never silently drop — send explicit error
      logger.error('Voice transcription failed', { chatId, error: error.message });
      await this.bot.sendMessage(chatId,
        `I received your voice message but couldn't process it: ${error.message}\n\nPlease try again or type your message.`
      );
    }
  }

  async _transcribeAudio(audioBuffer, filePath) {
    const whisperEndpoint = this.config.whisperEndpoint || 'https://api.openai.com/v1/audio/transcriptions';
    const whisperApiKey = this.config.whisperApiKey || process.env.OPENAI_API_KEY;
    const whisperModel = this.config.whisperModel || 'whisper-1';

    if (!whisperApiKey) throw new Error('Whisper API key not configured (set OPENAI_API_KEY)');

    const ext = filePath.split('.').pop() || 'ogg';
    const mimeTypes = { ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm' };
    const mimeType = mimeTypes[ext] || 'audio/ogg';

    const boundary = '----PhoenixEchoBoundary' + Date.now();
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const footer = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${whisperModel}\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, audioBuffer, footer]);

    const response = await fetch(whisperEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${whisperApiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${errorText}`);
    }
    return (await response.json()).text || '';
  }

  async sendMessage(chatId, message) {
    if (!this.bot) throw new Error('Telegram bot not initialized');
    await this.bot.sendMessage(chatId, message);
  }

  isReady() { return this.ready; }

  async cleanup() {
    if (this.bot) {
      await this.bot.stopPolling();
      this.ready = false;
      logger.info('TelegramAdapter stopped');
    }
  }
}
