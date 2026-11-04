import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { config, enabledAlertChannels } from '../config.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger(config.logLevel, 'notifiers');

let emailTransporter = null;

function getEmailTransporter() {
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  }
  return emailTransporter;
}

const notifiers = {
  email: {
    name: 'email',
    async send(event) {
      await getEmailTransporter().sendMail({
        from: config.smtp.from,
        to: config.smtp.to,
        subject: event.title,
        text: event.body,
      });
    },
  },

  telegram: {
    name: 'telegram',
    async send(event) {
      const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: `${event.title}\n\n${event.body}`,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Telegram API ${response.status}: ${text.slice(0, 200)}`);
      }
    },
  },

  webhook: {
    name: 'webhook',
    async send(event) {
      const payload = JSON.stringify({
        id: event.id,
        kind: event.kind,
        severity: event.severity,
        title: event.title,
        body: event.body,
        meta: event.meta,
        createdAt: event.created_at || event.createdAt,
      });
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'DidehbanMonitor/1.0',
        'X-Didehban-Event': String(event.id),
      };
      if (config.webhook.secret) {
        headers['X-Didehban-Signature'] = `sha256=${crypto.createHmac('sha256', config.webhook.secret).update(payload).digest('hex')}`;
      }
      const response = await fetch(config.webhook.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Webhook ${response.status}: ${text.slice(0, 200)}`);
      }
    },
  },
};

export function getEnabledChannels() {
  return enabledAlertChannels();
}

export async function sendViaChannel(channel, event) {
  const notifier = notifiers[channel];
  if (!notifier) throw new Error(`کانال هشدار ناشناخته: ${channel}`);
  await notifier.send(event);
  logger.debug(`هشدار ${event.id} از کانال ${channel} ارسال شد.`);
}
