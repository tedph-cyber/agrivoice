import { describe, expect, it } from 'vitest';
import { harness } from './helpers';

describe('public API', () => {
  it('health and unknown routes', async () => {
    const h = await harness();
    expect((await h.json('GET', '/api/health')).body).toEqual({ ok: true });
    const r = await h.json('GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });

  it('sets security headers on every response', async () => {
    const h = await harness();
    for (const path of ['/api/health', '/api/nope', '/api/admin/me']) {
      const r = await h.req('GET', path);
      expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  it('places: states then LGAs', async () => {
    const h = await harness();
    const s = await h.json('GET', '/api/places');
    expect(s.body.states).toHaveLength(37);
    const l = await h.json('GET', '/api/places?state=Ogun');
    expect(l.body.lgas.map((x: { lga: string }) => x.lga)).toEqual(['Abeokuta North', 'Ifo', 'Ijebu Ode']);
    expect(l.body.lgas[0].locationId).toBeGreaterThan(0);
  });

  it('crops fall back to English names', async () => {
    const h = await harness();
    const c = await h.json('GET', '/api/crops?lang=ha');
    expect(c.body.crops.map((x: { name: string }) => x.name)).toEqual(['Cassava', 'Maize', 'Tomato']);
  });

  it('brief: 404 without approved content; unapproved and reviewer-less never shown', async () => {
    const h = await harness();
    const maize = (await h.db.prepare("SELECT id FROM crops WHERE slug='maize'").first<{ id: number }>())!.id;
    const ins = (status: string, reviewer: string | null, approved: string | null) =>
      h.db
        .prepare("INSERT INTO briefs (state, crop_id, language, week_start, title, body, reviewer, approved_at, status) VALUES ('Ogun', ?, 'en', '2026-11-09', 't', 'b', ?, ?, ?)")
        .bind(maize, reviewer, approved, status)
        .run();
    await ins('draft', 'Dr A', '2026-11-10T00:00:00Z');
    await ins('approved', null, '2026-11-10T00:00:00Z');
    await ins('approved', '  ', '2026-11-10T00:00:00Z');
    await ins('approved', 'Dr A', null);
    expect((await h.json('GET', `/api/brief?state=Ogun&cropId=${maize}`)).status).toBe(404);
    await ins('approved', 'Dr A', '2026-11-10T00:00:00Z');
    const ok = await h.json('GET', `/api/brief?state=Ogun&cropId=${maize}&lang=ha`);
    expect(ok.status).toBe(200);
    expect(ok.body.reviewer).toBe('Dr A');
    expect(ok.body.isPlaceholder).toBe(false);
  });

  it('brief returns the newest week', async () => {
    const h = await harness();
    const maize = (await h.db.prepare("SELECT id FROM crops WHERE slug='maize'").first<{ id: number }>())!.id;
    for (const [wk, title] of [['2026-11-02', 'old'], ['2026-11-09', 'new']])
      await h.db.prepare("INSERT INTO briefs (state, crop_id, language, week_start, title, body, reviewer, approved_at, status) VALUES ('Ogun', ?, 'en', ?, ?, 'b', 'R', 'x', 'approved')").bind(maize, wk, title).run();
    expect((await h.json('GET', `/api/brief?state=Ogun&cropId=${maize}`)).body.title).toBe('new');
  });

  it('validation errors use the error shape', async () => {
    const h = await harness();
    const r = await h.json('GET', '/api/brief?state=Ogun');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
    const r2 = await h.json('GET', '/api/forecast?locationId=abc');
    expect(r2.status).toBe(400);
  });

  it("SQL injection attempts are treated as data or rejected", async () => {
    const h = await harness();
    const r = await h.json('GET', "/api/prices?state=Ogun'%20OR%20'1'='1");
    expect(r.status).toBe(200);
    expect(r.body.prices).toEqual([]);
    const r2 = await h.json('GET', '/api/prices?cropId=1;DROP%20TABLE%20crops');
    expect(r2.status).toBe(400);
    expect((await h.json('GET', '/api/crops')).body.crops.length).toBe(3);
    const r3 = await h.json('GET', "/api/qa/search?q=' OR 1=1 --");
    expect(r3.status).toBe(200);
  });
});

describe('prices', () => {
  it('report -> pending -> invisible until approved -> visible with age, newest report per market/unit', async () => {
    const h = await harness({ demo: true });
    const code = h.reporterCode!;
    const market = (await h.db.prepare('SELECT id FROM markets ORDER BY id').first<{ id: number }>())!.id;
    const crop = (await h.db.prepare("SELECT id FROM crops WHERE slug='maize'").first<{ id: number }>())!.id;
    const before = (await h.json('GET', `/api/prices?cropId=${crop}&marketId=${market}`)).body.prices;
    const post = await h.json('POST', '/api/prices/report', { reporterCode: code.toLowerCase(), marketId: market, cropId: crop, unit: 'bag', priceNgn: 55000 });
    expect(post.status).toBe(201);
    expect(post.body.status).toBe('pending');
    const mid = (await h.json('GET', `/api/prices?cropId=${crop}&marketId=${market}`)).body.prices;
    expect(mid).toEqual(before);
    await h.admin('POST', `/prices/${post.body.id}/approve`);
    const after = (await h.json('GET', `/api/prices?cropId=${crop}&marketId=${market}`)).body.prices;
    const row = after.find((p: { priceNgn: number }) => p.priceNgn === 55000);
    expect(row).toBeTruthy();
    expect(row.ageDays).toBe(0);
    expect(row.isPlaceholder).toBe(false);
    expect(after.filter((p: { unit: string }) => p.unit === 'bag')).toHaveLength(1);
  });

  it('rejects unknown codes, bad bodies; rejected reports never appear', async () => {
    const h = await harness({ demo: true });
    const market = (await h.db.prepare('SELECT id FROM markets').first<{ id: number }>())!.id;
    const bad = await h.json('POST', '/api/prices/report', { reporterCode: 'ZZZZZZZZ', marketId: market, cropId: 1, unit: 'bag', priceNgn: 10 });
    expect(bad.status).toBe(403);
    const inv = await h.json('POST', '/api/prices/report', { reporterCode: h.reporterCode, marketId: market, cropId: 1, unit: 'bag', priceNgn: -5 });
    expect(inv.status).toBe(400);
    const p = await h.json('POST', '/api/prices/report', { reporterCode: h.reporterCode, marketId: market, cropId: 1, unit: 'kg', priceNgn: 999 });
    await h.admin('POST', `/prices/${p.body.id}/reject`);
    expect(JSON.stringify((await h.json('GET', '/api/prices')).body)).not.toContain('"priceNgn":999');
  });

  it('rate limits price reports with 429', async () => {
    const h = await harness({ demo: true });
    const market = (await h.db.prepare('SELECT id FROM markets').first<{ id: number }>())!.id;
    let last = 0;
    for (let i = 0; i < 32; i++) {
      last = (await h.json('POST', '/api/prices/report', { reporterCode: h.reporterCode, marketId: market, cropId: 1, unit: 'bag', priceNgn: 100 + i })).status;
    }
    expect(last).toBe(429);
  });
});

describe('Q&A and questions', () => {
  it('search returns scored approved matches only', async () => {
    const h = await harness();
    const ins = (q: string, kw: string, status: string, reviewer: string | null) =>
      h.db.prepare("INSERT INTO qa_items (crop_id, language, question, answer, keywords, reviewer, approved_at, status) VALUES (NULL, 'en', ?, 'ans', ?, ?, '2026-11-01T00:00:00Z', ?)").bind(q, kw, reviewer, status).run();
    await ins('How to store maize?', 'storage weevil', 'approved', 'Dr A');
    await ins('Draft storage question', 'storage weevil', 'draft', 'Dr A');
    await ins('No reviewer storage', 'storage weevil', 'approved', null);
    const r = await h.json('GET', '/api/qa/search?q=weevil%20storage');
    expect(r.body.matches).toHaveLength(1);
    expect(r.body.matches[0].score).toBe(1);
    expect((await h.json('GET', '/api/qa/search?q=fertilizer')).body.matches).toEqual([]);
    expect((await h.json('GET', '/api/qa/search?q=a')).status).toBe(400);
  });

  it('stores contact only with consent', async () => {
    const h = await harness();
    await h.json('POST', '/api/questions', { text: 'My leaves are yellow', language: 'en', contact: '+2348000000000', consentContact: false });
    await h.json('POST', '/api/questions', { text: 'My leaves are curling', language: 'en', contact: '+2348000000001', consentContact: true });
    const rows = (await h.db.prepare('SELECT text, contact FROM questions ORDER BY id').all<{ text: string; contact: string | null }>()).results;
    expect(rows[0]!.contact).toBeNull();
    expect(rows[1]!.contact).toBe('+2348000000001');
  });

  it('validates and rate limits questions and deletion requests', async () => {
    const h = await harness();
    expect((await h.json('POST', '/api/questions', { text: 'x' })).status).toBe(400);
    expect((await h.json('POST', '/api/questions', { text: 'hello there', contact: 'not a number', consentContact: true })).status).toBe(400);
    let status = 0;
    for (let i = 0; i < 12; i++) status = (await h.json('POST', '/api/questions', { text: 'question number ' + i })).status;
    expect(status).toBe(429);
    const d = await h.json('POST', '/api/privacy/delete-request', { note: 'please delete', contact: '0800' });
    expect(d.status).toBe(201);
    let s2 = 0;
    for (let i = 0; i < 6; i++) s2 = (await h.json('POST', '/api/privacy/delete-request', {})).status;
    expect(s2).toBe(429);
  });

  it('public stats are aggregate only', async () => {
    const h = await harness();
    const s = await h.json('GET', '/api/stats/public');
    expect(Object.keys(s.body).sort()).toEqual(['approvedPriceReports', 'questionsAnswered', 'registeredFarmers', 'simulatorSessions', 'ussdSessions']);
  });
});
