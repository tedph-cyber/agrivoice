import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { D1Shim, asD1 } from '../src/dev/d1-shim';
import { migrate, ROOT } from '../src/seed/index';
import { createApp } from '../src/app';
import type { Env } from '../src/env';

const sql = (f: string) => readFileSync(join(ROOT, 'deploy', f), 'utf8');
const n = async (db: D1Database, q: string) => (await db.prepare(q).first<{ n: number }>())!.n;

it('deploy/seed.sql and deploy/demo-content.sql load cleanly, twice, and give a working demo', async () => {
  const shim = new D1Shim();
  const db = asD1(shim);
  await migrate(db);
  for (let i = 0; i < 2; i++) {
    shim.sqlite.exec(sql('seed.sql'));
    shim.sqlite.exec(sql('demo-content.sql'));
  }
  expect(await n(db, 'SELECT COUNT(*) AS n FROM locations WHERE lga IS NULL')).toBe(37);
  expect(await n(db, "SELECT COUNT(*) AS n FROM locations WHERE state = 'Ogun' AND lga IS NOT NULL")).toBe(20);
  expect(await n(db, 'SELECT COUNT(*) AS n FROM crops')).toBe(3);
  expect(await n(db, 'SELECT COUNT(*) AS n FROM alert_rules WHERE needs_review = 1')).toBe(3);
  expect(await n(db, 'SELECT COUNT(*) AS n FROM briefs')).toBe(3);
  expect(await n(db, 'SELECT COUNT(*) AS n FROM markets')).toBe(2);
  expect(await n(db, 'SELECT COUNT(*) AS n FROM price_reports')).toBe(6);
  for (const t of ['briefs', 'qa_items', 'alert_advice', 'markets', 'price_reports'])
    expect(await n(db, `SELECT COUNT(*) AS n FROM ${t} WHERE is_placeholder = 0`), t).toBe(0);
  const app = createApp();
  const env = { DB: db } as unknown as Env;
  const get = async (p: string) => (await app.request(p, {}, env)).json() as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect((await get('/api/places')).states).toHaveLength(37);
  const crops = (await get('/api/crops')).crops;
  for (const c of crops) {
    expect((await get(`/api/brief?state=Ogun&cropId=${c.id}`)).isPlaceholder).toBe(true);
    expect((await get(`/api/prices?cropId=${c.id}&state=Ogun`)).prices.length).toBe(2);
  }
  expect((await get('/api/qa/search?q=example%20placeholder')).matches.length).toBeGreaterThan(0);
});
