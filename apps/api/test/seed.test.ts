import { describe, expect, it } from 'vitest';
import { D1Shim, asD1 } from '../src/dev/d1-shim';
import { migrate, purge, seedBase, renderSql, baseSeedStatements, lgaStatements } from '../src/seed/index';
import { seedDemo } from '../src/seed/demo';
import { harness, NOW } from './helpers';

const count = async (db: D1Database, t: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

describe('migrations and seeds', () => {
  it('migration creates every table and is idempotent', async () => {
    const db = asD1(new D1Shim());
    expect((await migrate(db)).length).toBeGreaterThan(0);
    expect(await migrate(db)).toEqual([]);
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results.map((t) => t.name);
    for (const t of ['locations', 'crops', 'markets', 'reporters', 'price_reports', 'briefs', 'qa_items', 'alert_rules', 'alert_advice', 'forecast_cache', 'farmers', 'consents', 'questions', 'deletion_requests', 'ussd_sessions', 'events', 'rate_limits', 'admin_audit'])
      expect(tables).toContain(t);
  });

  it('base seed: 37 states, template crops, three needs_review rules; re-run is idempotent', async () => {
    const db = asD1(new D1Shim());
    await migrate(db);
    await seedBase(db);
    await seedBase(db);
    expect(await count(db, 'locations')).toBe(37);
    expect(await count(db, 'crops')).toBe(3);
    const rules = (await db.prepare('SELECT key, threshold, needs_review FROM alert_rules ORDER BY key').all<{ key: string; threshold: number; needs_review: number }>()).results;
    expect(rules).toEqual([
      { key: 'dry_spell', threshold: 7, needs_review: 1 },
      { key: 'heat', threshold: 38, needs_review: 1 },
      { key: 'heavy_rain', threshold: 50, needs_review: 1 },
    ]);
    expect(await count(db, 'briefs')).toBe(0);
    expect(await count(db, 'markets')).toBe(0);
    expect(await count(db, 'price_reports')).toBe(0);
  });

  it('constraints: unique location, price must be positive', async () => {
    const h = await harness();
    await expect(h.db.prepare("INSERT INTO locations (state, lga, lat, lon) VALUES ('Ogun', 'Ifo', 1, 1)").run()).rejects.toThrow();
    await expect(h.db.prepare("INSERT INTO price_reports (market_id, crop_id, unit, price_ngn, reported_at) VALUES (1,1,'bag',0,'x')").run()).rejects.toThrow();
  });

  it('LGA seeding: geocode success, failure and fallback to the state point', async () => {
    const stmts = await lgaStatements('Ogun', ['A', 'B', 'C'], { lat: 7, lon: 3 }, async (n) => {
      if (n === 'A') return { lat: 1, lon: 2 };
      if (n === 'B') return null;
      throw new Error('offline');
    });
    expect(stmts.map((s) => s.params.slice(2))).toEqual([[1, 2, 'open-meteo-geocoding'], [7, 3, 'state-point-fallback'], [7, 3, 'state-point-fallback']]);
  });

  it('SQL rendering escapes quotes (for remote D1 seeding)', () => {
    const sql = renderSql([{ sql: 'INSERT INTO t (a, b) VALUES (?, ?)', params: ["O'Brien", 5] }]);
    expect(sql).toBe("INSERT INTO t (a, b) VALUES ('O''Brien', 5);\n");
    expect(renderSql(baseSeedStatements()).split('\n').length).toBeGreaterThan(40);
  });

  it('demo seed: everything flagged as placeholder, idempotent, one reporter code', async () => {
    const h = await harness({ demo: true });
    expect(h.reporterCode).toMatch(/^[A-Z2-9]{8}$/);
    const before = await count(h.db, 'briefs');
    expect(before).toBeGreaterThan(0);
    const again = await seedDemo(h.db, { pepper: h.env.REPORTER_PEPPER!, now: NOW });
    expect(again.reporterCode).toBeNull();
    expect(await count(h.db, 'briefs')).toBe(before);
    for (const t of ['briefs', 'qa_items', 'alert_advice', 'markets', 'price_reports'])
      expect((await h.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE is_placeholder = 0`).first<{ n: number }>())!.n, t).toBe(0);
  });

  it('purge applies retention rules', async () => {
    const h = await harness();
    const old = new Date(NOW.getTime() - 2 * 86400_000).toISOString();
    const older = new Date(NOW.getTime() - 31 * 86400_000).toISOString();
    await h.db.prepare("INSERT INTO ussd_sessions VALUES ('old','h','{}',?)").bind(old).run();
    await h.db.prepare("INSERT INTO ussd_sessions VALUES ('new','h','{}',?)").bind(NOW.toISOString()).run();
    await h.db.prepare("INSERT INTO rate_limits VALUES ('k',?,1)").bind(old).run();
    await h.db.prepare("INSERT INTO questions (channel, text, contact, created_at) VALUES ('ussd','t','+234800',?)").bind(older).run();
    await h.db.prepare("INSERT INTO questions (channel, text, contact, created_at) VALUES ('ussd','t','+234801',?)").bind(NOW.toISOString()).run();
    await h.db.prepare("INSERT INTO events (at, channel, kind) VALUES (?, 'ussd', 'session')").bind(older).run();
    const r = await purge(h.db, NOW);
    expect(r).toEqual({ ussd_sessions: 1, rate_limits: 1, question_contacts: 1 });
    expect(await count(h.db, 'ussd_sessions')).toBe(1);
    const contacts = (await h.db.prepare('SELECT contact FROM questions ORDER BY id').all<{ contact: string | null }>()).results.map((c) => c.contact);
    expect(contacts).toEqual([null, '+234801']);
    expect(await count(h.db, 'events')).toBe(1);
  });
});
