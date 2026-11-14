import { Hono } from 'hono';
import { constantTimeEqual } from '@agrivoice/core';
import type { AppEnv } from '../env';
import { makeNotifier } from '../adapters/notifier';
import { handleTelegramMessage, webhookSecret } from '../lib/telegram';
import { limit } from '../lib/ratelimit';

export const telegramRoutes = new Hono<AppEnv>();

// Flagged off: without TELEGRAM_BOT_TOKEN this endpoint does not exist (404).
telegramRoutes.post('/telegram/webhook', async (c) => {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  const given = c.req.header('x-telegram-bot-api-secret-token') ?? '';
  if (!constantTimeEqual(given, await webhookSecret(token))) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  await limit(c, 'telegram', 600, 3600);
  let update: { message?: { chat?: { id?: number | string }; text?: string } };
  try {
    update = await c.req.json();
  } catch {
    return c.json({ ok: true });
  }
  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (chatId === undefined || typeof text !== 'string' || text.length > 500) return c.json({ ok: true });
  const reply = await handleTelegramMessage(c.env, c.get('deps'), String(chatId), text);
  await makeNotifier(c.env, 'telegram', c.get('deps').fetch).send(String(chatId), reply);
  return c.json({ ok: true });
});
