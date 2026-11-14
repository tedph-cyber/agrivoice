import { describe, expect, it } from 'vitest';
import { AtSmsNotifier, MockNotifier, TelegramNotifier, makeNotifier, smsEnabled, telegramEnabled } from '../src/adapters/notifier';
import { appDeps } from '../src/app';
import { dispatchTelegramAlerts, webhookSecret } from '../src/lib/telegram';
import { forecastJson, harness, NOW } from './helpers';

const TOKEN = '123456:TEST-TOKEN';

async function tg(h: Awaited<ReturnType<typeof harness>>, chat: number, text: string, secret?: string) {
  return h.json('POST', '/api/telegram/webhook', { message: { chat: { id: chat }, text } }, { 'x-telegram-bot-api-secret-token': secret ?? (await webhookSecret(TOKEN)) });
}

describe('notifier adapters', () => {
  it('mock is the default and nothing real is enabled without secrets', async () => {
    const h = await harness();
    expect(makeNotifier(h.env, 'telegram').name).toBe('mock');
    expect(makeNotifier(h.env, 'sms').name).toBe('mock');
    expect(telegramEnabled(h.env)).toBe(false);
    expect(smsEnabled(h.env)).toBe(false);
    const m = new MockNotifier();
    await m.send('x', 'hi');
    expect(m.sent).toEqual([{ to: 'x', text: 'hi' }]);
  });

  it('Telegram posts sendMessage JSON to the Bot API', async () => {
    const calls: { url: string; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    expect((await new TelegramNotifier(TOKEN, f).send('42', 'hello')).ok).toBe(true);
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ chat_id: '42', text: 'hello' });
  });

  it("Africa's Talking SMS: sandbox host, form body, apiKey header; no real sends in tests", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    expect((await new AtSmsNotifier('sandbox', 'KEY', f).send('+2340000000000', 'Rain')).ok).toBe(true);
    expect(calls[0]!.url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    expect((calls[0]!.init.headers as Record<string, string>).apiKey).toBe('KEY');
    expect(new URLSearchParams(String(calls[0]!.init.body)).get('to')).toBe('+2340000000000');
    await new AtSmsNotifier('myapp', 'KEY', f).send('+2340000000000', 'x');
    expect(calls[1]!.url).toBe('https://api.africastalking.com/version1/messaging');
    const h = await harness({ envOverrides: { AT_USERNAME: 'sandbox', AT_API_KEY: 'k' } });
    expect(makeNotifier(h.env, 'sms').name).toBe('at-sms');
  });
});

describe('Telegram alerts', () => {
  it('webhook does not exist without a token, and rejects a wrong secret', async () => {
    const h = await harness();
    expect((await tg(h, 1, '/start', 'x')).status).toBe(404);
    const on = await harness({ envOverrides: { TELEGRAM_BOT_TOKEN: TOKEN } });
    expect((await tg(on, 1, '/start', 'wrong')).status).toBe(404);
    expect((await on.json('POST', '/api/telegram/webhook', {})).status).toBe(404);
  });

  it('subscribe, de-duplicated dispatch, new date resends, stop deletes', async () => {
    const h = await harness({ envOverrides: { TELEGRAM_BOT_TOKEN: TOKEN } });
    const sentToBot: string[] = [];
    // replies go through the mock fetch; capture them
    const outbound = (async (_u: string, init: RequestInit) => {
      sentToBot.push(String(init.body));
      return new Response('{}');
    }) as unknown as typeof fetch;
    const deps = appDeps({ fetch: (async () => Response.json(forecastJson([0, 0, 70, 0, 0, 0, 0]))) as typeof fetch, now: () => NOW });
    expect((await tg(h, 7, '/subscribe Nowhere, maize')).status).toBe(200);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM telegram_subscriptions').first<{ n: number }>()).toEqual({ n: 0 });
    await tg(h, 7, '/subscribe Ogun, Ifo, maize');
    await tg(h, 8, '/subscribe Ogun, cassava');
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM telegram_subscriptions').first<{ n: number }>()).toEqual({ n: 2 });
    void outbound;

    const mock = new MockNotifier();
    const r1 = await dispatchTelegramAlerts(h.env, deps, mock);
    expect(r1).toEqual({ sent: 2, checked: 2 });
    expect(mock.sent[0]!.text).toContain('Heavy rain forecast for Ifo on 16 Nov: 70 mm');
    expect(mock.sent[0]!.text).toContain('(Unconfirmed threshold)');
    const r2 = await dispatchTelegramAlerts(h.env, deps, mock);
    expect(r2.sent).toBe(0);
    const later = appDeps({ fetch: (async () => Response.json({ daily: { ...forecastJson([0, 0, 80, 0, 0, 0, 0]).daily, time: ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'] } })) as typeof fetch, now: () => new Date(NOW.getTime() + 4 * 3600_000) });
    expect((await dispatchTelegramAlerts(h.env, later, mock)).sent).toBe(2);
    await tg(h, 7, '/stop');
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM telegram_subscriptions').first<{ n: number }>()).toEqual({ n: 1 });
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM alert_dispatches WHERE chat_id = '7'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('failed sends are retried and approved advice (flagged demo) is included', async () => {
    const h = await harness({ demo: true, envOverrides: { TELEGRAM_BOT_TOKEN: TOKEN } });
    await tg(h, 9, '/subscribe Ogun, Ifo, maize');
    const deps = appDeps({ fetch: (async () => Response.json(forecastJson([0, 0, 70, 0, 0, 0, 0]))) as typeof fetch, now: () => NOW });
    const failing = { name: 'mock' as const, send: async () => ({ ok: false }) };
    expect((await dispatchTelegramAlerts(h.env, deps, failing)).sent).toBe(0);
    const mock = new MockNotifier();
    expect((await dispatchTelegramAlerts(h.env, deps, mock)).sent).toBe(1);
    expect(mock.sent[0]!.text).toContain('Demo data: [PLACEHOLDER]');
  });

  it('weather outage skips quietly', async () => {
    const h = await harness({ envOverrides: { TELEGRAM_BOT_TOKEN: TOKEN } });
    await tg(h, 5, '/subscribe Ogun, maize');
    const deps = appDeps({ fetch: (async () => { throw new Error('down'); }) as typeof fetch, now: () => NOW });
    expect(await dispatchTelegramAlerts(h.env, deps, new MockNotifier())).toEqual({ sent: 0, checked: 1 });
  });
});
