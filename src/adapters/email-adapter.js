/**
 * Phoenix Echo Bot - Email Adapter
 *
 * IMAP polling for inbound messages, SMTP for outbound.
 * Supports HTML email formatting with Phoenix branding and attachment handling.
 *
 * NOTE: This adapter uses the built-in Node.js net/tls modules for IMAP/SMTP
 * with lightweight protocol handling. For production, consider nodemailer or
 * a dedicated IMAP library.
 */

import { randomUUID } from 'crypto';
import { createTransport } from 'nodemailer';
import { BaseAdapter } from './base-adapter.js';

/** @typedef {import('../types.js').NormalizedMessage} NormalizedMessage */

// TODO(gateway): Add nodemailer to package.json dependencies when email is enabled

export class EmailAdapter extends BaseAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.config - Email configuration
   * @param {string} options.config.imapHost - IMAP server hostname
   * @param {number} [options.config.imapPort=993] - IMAP server port
   * @param {string} options.config.smtpHost - SMTP server hostname
   * @param {number} [options.config.smtpPort=587] - SMTP server port
   * @param {string} options.config.address - Email address
   * @param {string} options.config.password - Email password
   * @param {number} [options.config.pollIntervalMs=60000] - IMAP poll interval
   * @param {Function} [options.onMessage] - Inbound message callback
   */
  constructor(options = {}) {
    super({ ...options, platform: 'email' });
    this.imapHost = this.config.imapHost || '';
    this.imapPort = this.config.imapPort || 993;
    this.smtpHost = this.config.smtpHost || '';
    this.smtpPort = this.config.smtpPort || 587;
    this.address = this.config.address || '';
    this.password = this.config.password || '';
    this.pollIntervalMs = this.config.pollIntervalMs || 60000;
    this._pollTimer = null;
    this._transporter = null;
  }

  /** @returns {Promise<void>} */
  async init() {
    if (!this.address || !this.password) {
      this.logger.warn('Email adapter disabled: missing address or password');
      return;
    }

    // TODO(gateway): Implement IMAP connection for inbound email polling
    // For now, set up SMTP transporter for outbound only
    if (this.smtpHost) {
      try {
        this._transporter = createTransport({
          host: this.smtpHost,
          port: this.smtpPort,
          secure: this.smtpPort === 465,
          auth: {
            user: this.address,
            pass: this.password
          }
        });

        this.logger.info('Email SMTP transporter configured', {
          host: this.smtpHost,
          port: this.smtpPort
        });
      } catch (error) {
        this.logger.error('Failed to create SMTP transporter', { error: error.message });
      }
    }

    // TODO(gateway): Start IMAP polling loop
    if (this.imapHost) {
      this._startPolling();
    }

    await super.init();
    this.logger.info('Email adapter initialized', { address: this.address });
  }

  /** @returns {Promise<void>} */
  async shutdown() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._transporter) {
      this._transporter.close();
      this._transporter = null;
    }
    await super.shutdown();
  }

  /**
   * Start IMAP polling for new emails
   * @private
   */
  _startPolling() {
    this._pollTimer = setInterval(async () => {
      try {
        await this._pollInbox();
      } catch (error) {
        this.logger.error('Email poll error', { error: error.message });
      }
    }, this.pollIntervalMs);

    if (typeof this._pollTimer.unref === 'function') {
      this._pollTimer.unref();
    }

    this.logger.info('Email IMAP polling started', {
      host: this.imapHost,
      intervalMs: this.pollIntervalMs
    });
  }

  /**
   * Poll inbox for new messages
   * @private
   */
  async _pollInbox() {
    // TODO(gateway): Implement IMAP IDLE or FETCH for new messages
    // This is a stub that will be connected to a real IMAP client
    this.logger.debug('Email poll cycle (stub)');
  }

  /**
   * Send an email
   * @param {string} channelId - Recipient email address
   * @param {string} text - Message body
   * @param {Object} [options] - Options (subject, html, attachments)
   * @returns {Promise<void>}
   */
  async sendMessage(channelId, text, options = {}) {
    if (!this._transporter) {
      throw new Error('Email SMTP transporter not configured');
    }

    const htmlBody = options.html || this._buildHtmlEmail(text);
    const subject = options.subject || 'Phoenix Electric - Echo Response';

    const mailOptions = {
      from: `"Phoenix Echo" <${this.address}>`,
      to: channelId,
      subject,
      text: this.formatResponse(text),
      html: htmlBody
    };

    if (options.attachments && Array.isArray(options.attachments)) {
      mailOptions.attachments = options.attachments;
    }

    // TODO(gateway): Send via Microsoft Graph API as alternative
    await this._transporter.sendMail(mailOptions);
    this.logger.info('Email sent', { to: channelId, subject });
  }

  /**
   * Build branded HTML email from plain text
   * @param {string} text - Plain text content
   * @returns {string} HTML email
   * @private
   */
  _buildHtmlEmail(text) {
    const bodyHtml = String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header { background: #1a1a2e; padding: 20px; text-align: center; }
    .header h1 { color: #ff6b35; margin: 0; font-size: 20px; }
    .header p { color: #ccc; margin: 4px 0 0; font-size: 12px; }
    .content { padding: 24px; line-height: 1.6; color: #333; }
    .footer { background: #f8f8f8; padding: 16px; text-align: center; font-size: 11px; color: #888; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Phoenix Electric LLC</h1>
      <p>Powered by Echo AI</p>
    </div>
    <div class="content">${bodyHtml}</div>
    <div class="footer">
      Phoenix Electric LLC | Colorado<br>
      This message was generated by Phoenix Echo AI assistant.
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Format response for plain text email
   * @param {string} text - Raw text
   * @returns {string}
   */
  formatResponse(text) {
    // Strip markdown for plain text fallback
    let formatted = String(text || '');
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '$1');
    formatted = formatted.replace(/`([^`]+)`/g, '$1');
    formatted = formatted.replace(/```[\s\S]*?```/g, (match) => {
      return match.replace(/```\w*\n?/g, '').replace(/```/g, '');
    });
    return formatted;
  }

  /**
   * Normalize an inbound email into NormalizedMessage
   * @param {Object} raw - Raw email object
   * @returns {NormalizedMessage}
   */
  normalizeInbound(raw) {
    return {
      id: raw.messageId || randomUUID(),
      platform: 'email',
      channelId: raw.from || '',
      userId: raw.from || '',
      userName: raw.fromName || raw.from || '',
      text: raw.textBody || raw.htmlBody || '',
      attachments: (raw.attachments || []).map((att) => ({
        type: att.contentType || 'application/octet-stream',
        url: att.path || '',
        name: att.filename || 'attachment'
      })),
      metadata: {
        subject: raw.subject || '',
        to: raw.to || '',
        cc: raw.cc || '',
        inReplyTo: raw.inReplyTo || '',
        headers: raw.headers || {}
      },
      timestamp: raw.date ? new Date(raw.date).toISOString() : new Date().toISOString()
    };
  }
}

export default EmailAdapter;
