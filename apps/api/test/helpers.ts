import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { D1Shim, asD1 } from '../src/dev/d1-shim';
import { lgaStatements, migrate, runStatements, seedBase } from '../src/seed/index';
import { seedDemo } from '../src/seed/demo';
import { hashPassword } from '../src/lib/auth';

export const NOW = new Date('2026-11-14T10:00:00Z');
export const PASSWORD = 'correct horse battery';
export const USSD_TOKEN = 'tok_test_123456';

export function forecastJson(precip: number[] = [0, 1, 2, 3, 4, 5, 6], tmax = 30) {
  return {
    daily: {
      time: precip.map((_, i) => `2026-11-${14 + i}`),
      precipitation_sum: precip,
      temperature_2m_max: precip.map(() => tmax),
      temperature_2m_min: precip.map(() => 21),
      precipitation_probability_max: precip.map(() => 40),
    },
  };
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  env: Env;
  db: D1Database;
  shim: D1Shim;
  setNow(d: Date): void;
  fetchCalls: string[];
  setForecast(f: (() => Response | Promise<Response>) | null): void;
  req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  json(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  login(): Promise<string>;
  admin(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  cookie: string;
  reporterCode: string | null;
}

export async function harness(opts: { demo?: boolean; envOverrides?: Partial<Env> } = {}): Promise<Harness> {
  const shim = new D1Shim(':memory:');
  const db = asD1(shim);
  await migrate(db);
  await seedBase(db);
  const ogun = (await db.prepare("SELECT lat, lon FROM locations WHERE state = 'Ogun'").first<{ lat: number; lon: number }>())!;
  await runStatements(db, await lgaStatements('Ogun', ['Abeokuta North', 'Ifo', 'Ijebu Ode'], ogun));
  const env: Env = {
    DB: db,
    ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD, 1000),
    SESSION_SECRET: 's'.repeat(64),
    PHONE_HASH_SECRET: 'p'.repeat(64),
    REPORTER_PEPPER: 'r'.repeat(64),
    USSD_PATH_TOKEN: USSD_TOKEN,
    ...opts.envOverrides,
  };
  let now = NOW;
  let forecast: (() => Response | Promise<Response>) | null = () => Response.json(forecastJson());
  const fetchCalls: string[] = [];
  const mockFetch = (async (url: string | URL | Request) => {
    fetchCalls.push(String(url));
    if (!forecast) throw new Error('network down');
    return forecast();
  }) as typeof fetch;
  const app = createApp({ fetch: mockFetch, now: () => now });
  let reporterCode: string | null = null;
  if (opts.demo) reporterCode = (await seedDemo(db, { pepper: env.REPORTER_PEPPER!, now })).reporterCode;
  const h: Harness = {
    app,
    env,
    db,
    shim,
    fetchCalls,
    cookie: '',
    reporterCode,
    setNow: (d) => {
      now = d;
    },
    setForecast: (f) => {
      forecast = f;
    },
    async req(method, path, body, headers = {}) {
      const init: RequestInit = { method, headers: { ...headers } };
      if (body !== undefined) {
        if (typeof body === 'string' || body instanceof URLSearchParams) {
          init.body = body;
          (init.headers as Record<string, string>)['content-type'] ??= 'application/x-www-form-urlencoded';
        } else {
          init.body = JSON.stringify(body);
          (init.headers as Record<string, string>)['content-type'] = 'application/json';
        }
      }
      return app.request(path, init, env);
    },
    async json(method, path, body, headers) {
      const r = await h.req(method, path, body, headers);
      const text = await r.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* text */
      }
      return { status: r.status, body: parsed };
    },
    async login() {
      const r = await h.req('POST', '/api/admin/login', { password: PASSWORD }, { 'x-requested-with': 'test' });
      const set = r.headers.get('set-cookie') ?? '';
      h.cookie = set.split(';')[0] ?? '';
      return h.cookie;
    },
    async admin(method, path, body) {
      if (!h.cookie) await h.login();
      return h.json(method, `/api/admin${path}`, body, { cookie: h.cookie, 'x-requested-with': 'test' });
    },
  };
  return h;
}

export async function ussd(h: Harness, sessionId: string, phone: string, text: string): Promise<string> {
  const form = new URLSearchParams({ sessionId, serviceCode: '*384*1#', phoneNumber: phone, text, networkCode: '62120' });
  const r = await h.req('POST', `/api/ussd/at/${USSD_TOKEN}`, form);
  return r.text();
}
