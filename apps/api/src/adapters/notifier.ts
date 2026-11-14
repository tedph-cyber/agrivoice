// Outbound notification adapters. The mock is the default; real senders are flagged off unless configured.
import type { Env } from '../env';

export interface Notifier {
  readonly name: 'mock' | 'telegram' | 'at-sms';
  send(to: string, text: string): Promise<{ ok: boolean }>;
}

export class MockNotifier implements Notifier {
  readonly name = 'mock' as const;
  sent: { to: string; text: string }[] = [];
  async send(to: string, text: string) {
    this.sent.push({ to, text });
    return { ok: true };
  }
}

export class TelegramNotifier implements Notifier {
  readonly name = 'telegram' as const;
  constructor(
    private token: string,
    private f: typeof fetch = fetch,
  ) {}
  async send(chatId: string, text: string) {
    const res = await this.f(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok };
  }
}

/** Africa's Talking SMS. Sandbox host is used when the username is "sandbox". */
export class AtSmsNotifier implements Notifier {
  readonly name = 'at-sms' as const;
  constructor(
    private username: string,
    private apiKey: string,
    private f: typeof fetch = fetch,
  ) {}
  async send(to: string, text: string) {
    const host = this.username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
    const res = await this.f(`https://${host}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey: this.apiKey, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.username, to, message: text }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok };
  }
}

export function telegramEnabled(env: Env): boolean {
  return !!env.TELEGRAM_BOT_TOKEN;
}
export function smsEnabled(env: Env): boolean {
  return !!env.AT_USERNAME && !!env.AT_API_KEY;
}

export function makeNotifier(env: Env, channel: 'telegram' | 'sms', f: typeof fetch = fetch): Notifier {
  if (channel === 'telegram' && env.TELEGRAM_BOT_TOKEN) return new TelegramNotifier(env.TELEGRAM_BOT_TOKEN, f);
  if (channel === 'sms' && env.AT_USERNAME && env.AT_API_KEY) return new AtSmsNotifier(env.AT_USERNAME, env.AT_API_KEY, f);
  return new MockNotifier();
}
