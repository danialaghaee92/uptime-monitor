import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { withTransaction } from '../db.js';
import { config } from '../config.js';
import { getSettings, toApiSettings, updateSettings } from '../services/settings.js';

export const adminSettingsRouter = express.Router();
adminSettingsRouter.use(requireAdmin);

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function channelsStatus() {
  const smtp = config.smtp || {};
  const telegram = config.telegram || {};
  const webhook = config.webhook || {};
  return {
    email: {
      enabled: Boolean(smtp.host && smtp.from && smtp.to),
      host: smtp.host || null,
      from: smtp.from ? maskEmail(smtp.from) : null,
      to: smtp.to ? maskEmail(smtp.to) : null,
    },
    telegram: {
      enabled: Boolean(telegram.botToken && telegram.chatId),
    },
    webhook: {
      enabled: Boolean(webhook.url),
      url: safeOrigin(webhook.url),
    },
  };
}

adminSettingsRouter.get('/settings', async (req, res) => {
  const settings = await getSettings();
  res.json({ settings: toApiSettings(settings), channels: channelsStatus() });
});

adminSettingsRouter.patch('/settings', async (req, res) => {
  const payload = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body || {};
  const updated = await withTransaction(async (client) => {
    const before = await getSettings(client);
    const after = await updateSettings(payload, client);

    if (Number(before.global_ssl_interval_seconds) !== Number(after.global_ssl_interval_seconds)) {
      await client.query(
        `UPDATE targets
         SET ssl_next_check_at = now(), updated_at = now()
         WHERE ssl_enabled AND is_active AND ssl_interval_seconds IS NULL`,
      );
    }
    return after;
  });

  res.json({ settings: toApiSettings(updated), channels: channelsStatus() });
});
