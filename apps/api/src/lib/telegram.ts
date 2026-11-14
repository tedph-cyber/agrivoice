import { hmacSha256Hex, t } from '@agrivoice/core';
import type { Deps, Env } from '../env';
import type { Notifier } from '../adapters/notifier';
import { buildAlerts, placeName } from './content';
import { getForecast, getLocation } from './forecast';

export async function webhookSecret(token: string): Promise<string> {
  return (await hmacSha256Hex(token, 'agrivoice-telegram-webhook')).slice(0, 48);
}

const HELP =
  'AgriVoice alerts. Send: /subscribe State, LGA, crop (LGA is optional), for example /subscribe Ogun, Ifo, maize. Send /stop to stop and delete your subscription. Alerts are weather facts with approved advice only; thresholds marked unconfirmed are not yet checked by an agronomist.';

export async function handleTelegramMessage(env: Env, deps: Deps, chatId: string, text: string): Promise<string> {
  const db = env.DB;
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = (cmdRaw ?? '').toLowerCase().replace(/@.*$/, '');
  if (cmd === '/stop') {
    await db.prepare('DELETE FROM telegram_subscriptions WHERE chat_id = ?').bind(chatId).run();
    await db.prepare('DELETE FROM alert_dispatches WHERE chat_id = ?').bind(chatId).run();
    return 'Stopped. Your subscription was deleted.';
  }
  if (cmd === '/subscribe') {
    const parts = rest.join(' ').split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return HELP;
    const [state, ...more] = parts;
    const cropText = more[more.length - 1]!.toLowerCase();
    const lga = more.length === 2 ? more[0]! : null;
    const loc = await db
      .prepare('SELECT id FROM locations WHERE LOWER(state) = LOWER(?) AND ' + (lga ? 'LOWER(lga) = LOWER(?)' : 'lga IS NULL'))
      .bind(...(lga ? [state, lga] : [state]))
      .first<{ id: number }>();
    const crop = await db.prepare('SELECT id FROM crops WHERE slug = ? OR LOWER(name_en) = ?').bind(cropText, cropText).first<{ id: number }>();
    if (!loc || !crop) return `I could not find that place or crop. ${HELP}`;
    await db
      .prepare(
        'INSERT INTO telegram_subscriptions (chat_id, location_id, crop_id, language, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET location_id = excluded.location_id, crop_id = excluded.crop_id',
      )
      .bind(chatId, loc.id, crop.id, 'en', deps.now().toISOString())
      .run();
    return 'Subscribed. You will get a message when a weather alert applies to your place.';
  }
  return HELP;
}

/** Evaluate alerts for every subscription and send each (chat, rule, date) once. */
export async function dispatchTelegramAlerts(env: Env, deps: Deps, notifier: Notifier): Promise<{ sent: number; checked: number }> {
  const db = env.DB;
  const subs = (await db.prepare('SELECT chat_id, location_id, crop_id, language FROM telegram_subscriptions').all<{ chat_id: string; location_id: number; crop_id: number; language: string }>()).results;
  let sent = 0;
  for (const s of subs) {
    const loc = await getLocation(db, s.location_id);
    if (!loc) continue;
    let alerts;
    try {
      const f = await getForecast(env, deps, loc);
      alerts = await buildAlerts(db, f.days, placeName(loc), s.crop_id, s.language);
    } catch {
      continue; // weather unavailable: try again on the next run
    }
    for (const a of alerts) {
      const already = await db.prepare('SELECT 1 AS x FROM alert_dispatches WHERE chat_id = ? AND rule_key = ? AND alert_date = ?').bind(s.chat_id, a.ruleKey, a.date).first();
      if (already) continue;
      const lines = [`${t(s.language, `alert.severity.${a.severity}`)}: ${a.message}`];
      if (a.needsReview) lines.push(`(${t(s.language, 'alert.unconfirmed')})`);
      if (a.advice) lines.push((a.isPlaceholder ? `${t(s.language, 'web.demo_data')}: ` : '') + a.advice);
      const r = await notifier.send(s.chat_id, lines.join('\n'));
      if (!r.ok) continue;
      await db.prepare('INSERT OR IGNORE INTO alert_dispatches (chat_id, rule_key, alert_date, sent_at) VALUES (?, ?, ?, ?)').bind(s.chat_id, a.ruleKey, a.date, deps.now().toISOString()).run();
      sent++;
    }
  }
  return { sent, checked: subs.length };
}
