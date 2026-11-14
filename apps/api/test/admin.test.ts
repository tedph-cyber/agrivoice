import { describe, expect, it } from 'vitest';
import { harness, NOW, PASSWORD } from './helpers';

const H = { 'x-requested-with': 'test' };

describe('admin auth', () => {
  it('every admin route requires a session', async () => {
    const h = await harness();
    const routes: [string, string][] = [
      ['GET', '/me'], ['GET', '/briefs'], ['POST', '/briefs'], ['PUT', '/briefs/1'], ['DELETE', '/briefs/1'], ['GET', '/qa'], ['GET', '/alert-advice'],
      ['GET', '/alert-rules'], ['GET', '/markets'], ['GET', '/crops'], ['GET', '/reporters'], ['POST', '/reporters'], ['GET', '/prices'],
      ['POST', '/prices/1/approve'], ['POST', '/prices/1/reject'], ['GET', '/questions'], ['POST', '/questions/1/answer'],
      ['GET', '/deletion-requests'], ['POST', '/deletion-requests/1/done'], ['GET', '/dashboard'],
    ];
    for (const [m, p] of routes) {
      const r = await h.json(m, `/api/admin${p}`, m === 'GET' ? undefined : {}, H);
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });

  it('login with right password sets a hardened cookie', async () => {
    const h = await harness();
    const r = await h.req('POST', '/api/admin/login', { password: PASSWORD }, H);
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=28800');
    h.cookie = cookie.split(';')[0]!;
    expect((await h.json('GET', '/api/admin/me', undefined, { cookie: h.cookie })).body).toEqual({ admin: true });
  });

  it('wrong password is rejected and then rate limited', async () => {
    const h = await harness();
    for (let i = 0; i < 5; i++) expect((await h.json('POST', '/api/admin/login', { password: 'nope' + i }, H)).status).toBe(401);
    expect((await h.json('POST', '/api/admin/login', { password: PASSWORD }, H)).status).toBe(429);
  });

  it('expired or tampered sessions are refused', async () => {
    const h = await harness();
    const cookie = await h.login();
    expect((await h.json('GET', '/api/admin/me', undefined, { cookie })).status).toBe(200);
    expect((await h.json('GET', '/api/admin/me', undefined, { cookie: cookie.slice(0, -2) + 'aa' })).status).toBe(401);
    h.setNow(new Date(NOW.getTime() + 8 * 3600_000 + 1000));
    expect((await h.json('GET', '/api/admin/me', undefined, { cookie })).status).toBe(401);
  });

  it('state changing requests need the custom header', async () => {
    const h = await harness();
    const cookie = await h.login();
    const r = await h.json('POST', '/api/admin/reporters', { displayName: 'A' }, { cookie });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
    expect((await h.json('POST', '/api/admin/login', { password: PASSWORD })).status).toBe(403);
  });
});

describe('admin API', () => {
  it('reporter code is shown once and works for reports; only the hash is stored', async () => {
    const h = await harness({ demo: true });
    const market = (await h.db.prepare('SELECT id FROM markets').first<{ id: number }>())!.id;
    const created = await h.admin('POST', '/reporters', { displayName: 'Mama Ngozi', marketId: market });
    expect(created.status).toBe(201);
    expect(created.body.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    const list = await h.admin('GET', '/reporters');
    expect(JSON.stringify(list.body)).not.toContain(created.body.code);
    expect(JSON.stringify(list.body)).not.toContain('codeHash');
    const rows = await h.db.prepare('SELECT code_hash FROM reporters WHERE display_name = ?').bind('Mama Ngozi').first<{ code_hash: string }>();
    expect(rows!.code_hash).not.toContain(created.body.code);
    const rep = await h.json('POST', '/api/prices/report', { reporterCode: created.body.code, marketId: market, cropId: 1, unit: 'bag', priceNgn: 4200 });
    expect(rep.status).toBe(201);
    await h.admin('PUT', `/reporters/${created.body.id}`, { active: false });
    expect((await h.json('POST', '/api/prices/report', { reporterCode: created.body.code, marketId: market, cropId: 1, unit: 'bag', priceNgn: 4300 })).status).toBe(403);
  });

  it('briefs: approval requires a reviewer; approved_at is filled; audit rows are written', async () => {
    const h = await harness();
    const base = { state: 'Ogun', cropId: 1, language: 'en', weekStart: '2026-11-09', title: 'T', body: 'Body' };
    expect((await h.admin('POST', '/briefs', { ...base, status: 'approved' })).status).toBe(400);
    const draft = await h.admin('POST', '/briefs', base);
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe('draft');
    expect((await h.json('GET', '/api/brief?state=Ogun&cropId=1')).status).toBe(404);
    const up = await h.admin('PUT', `/briefs/${draft.body.id}`, { status: 'approved', reviewer: 'Dr Bello' });
    expect(up.status).toBe(200);
    expect(up.body.approvedAt).toBe(NOW.toISOString());
    expect((await h.json('GET', '/api/brief?state=Ogun&cropId=1')).status).toBe(200);
    expect((await h.admin('PUT', `/briefs/${draft.body.id}`, { ussdSummary: 'x'.repeat(141) })).status).toBe(400);
    expect((await h.admin('PUT', `/briefs/${draft.body.id}`, { audioUrl: 'javascript:alert(1)' })).status).toBe(400);
    const audit = (await h.db.prepare('SELECT action, entity FROM admin_audit').all<{ action: string; entity: string }>()).results;
    expect(audit.some((a) => a.action === 'create' && a.entity === 'briefs')).toBe(true);
    expect(audit.some((a) => a.action === 'update' && a.entity === 'briefs')).toBe(true);
    expect((await h.admin('DELETE', `/briefs/${draft.body.id}`)).status).toBe(200);
    expect((await h.admin('GET', `/briefs/${draft.body.id}`)).status).toBe(404);
  });

  it('alert rules: clearing needsReview needs a reviewer name', async () => {
    const h = await harness();
    const rules = (await h.admin('GET', '/alert-rules')).body.items;
    const rain = rules.find((r: { key: string }) => r.key === 'heavy_rain');
    expect(rain.needsReview).toBe(true);
    expect((await h.admin('PUT', `/alert-rules/${rain.id}`, { threshold: 60 })).body.needsReview).toBe(true);
    expect((await h.admin('PUT', `/alert-rules/${rain.id}`, { needsReview: false })).status).toBe(400);
    const ok = await h.admin('PUT', `/alert-rules/${rain.id}`, { needsReview: false, reviewer: 'Agronomist X' });
    expect(ok.body.needsReview).toBe(false);
    expect((await h.admin('PUT', `/alert-rules/${rain.id}`, { threshold: 'abc' })).status).toBe(400);
  });

  it('price moderation, questions queue and deletion requests', async () => {
    const h = await harness({ demo: true });
    await h.json('POST', '/api/prices/report', { reporterCode: h.reporterCode, marketId: 1, cropId: 1, unit: 'bag', priceNgn: 777 });
    await h.json('POST', '/api/prices/report', { reporterCode: h.reporterCode, marketId: 1, cropId: 1, unit: 'kg', priceNgn: 778 });
    const pend = (await h.admin('GET', '/prices?status=pending')).body.prices;
    expect(pend).toHaveLength(2);
    expect((await h.admin('POST', '/prices/bulk-approve', { ids: pend.map((p: { id: number }) => p.id) })).status).toBe(200);
    expect((await h.admin('GET', '/prices?status=pending')).body.prices).toHaveLength(0);
    expect((await h.admin('POST', `/prices/${pend[0].id}/approve`)).status).toBe(404);

    await h.json('POST', '/api/questions', { text: 'Why are my leaves yellow?' });
    const qs = (await h.admin('GET', '/questions?status=open')).body.questions;
    expect(qs).toHaveLength(1);
    expect((await h.admin('POST', `/questions/${qs[0].id}/answer`, { answer: '' })).status).toBe(400);
    expect((await h.admin('POST', `/questions/${qs[0].id}/answer`, { answer: 'An agent will advise.' })).status).toBe(200);
    expect((await h.admin('GET', '/questions?status=open')).body.questions).toHaveLength(0);
    expect((await h.admin('GET', '/questions?status=answered')).body.questions[0].answer).toBe('An agent will advise.');

    await h.json('POST', '/api/privacy/delete-request', { note: 'remove me' });
    const dr = (await h.admin('GET', '/deletion-requests')).body.requests;
    expect(dr[0].status).toBe('open');
    await h.admin('POST', `/deletion-requests/${dr[0].id}/done`);
    expect((await h.admin('GET', '/deletion-requests')).body.requests[0].status).toBe('done');
  });

  it('stored XSS strings are kept as data and returned as JSON only', async () => {
    const h = await harness();
    const xss = '<script>alert(1)</script>';
    const r = await h.admin('POST', '/markets', { name: xss, state: 'Ogun' });
    expect(r.status).toBe(201);
    const pub = await h.req('GET', '/api/markets?state=Ogun');
    expect(pub.headers.get('content-type')).toContain('application/json');
    expect(((await pub.json()) as { markets: { name: string }[] }).markets[0]!.name).toBe(xss);
  });

  it('dashboard counts placeholders', async () => {
    const h = await harness({ demo: true });
    const d = (await h.admin('GET', '/dashboard')).body;
    expect(d.placeholders.total).toBeGreaterThan(0);
    expect(d.placeholders.alertRulesNeedingReview).toBe(3);
  });

  it('crops CRUD keeps names as an object; FK conflicts return 409', async () => {
    const h = await harness({ demo: true });
    const c = await h.admin('POST', '/crops', { slug: 'rice', nameEn: 'Rice', names: { ha: 'Shinkafa' } });
    expect(c.body.names).toEqual({ ha: 'Shinkafa' });
    expect((await h.admin('POST', '/crops', { slug: 'rice', nameEn: 'Rice' })).status).toBe(409);
    expect((await h.admin('DELETE', '/crops/1')).status).toBe(409);
    expect((await h.admin('DELETE', '/alert-rules/1')).status).toBe(409);
  });
});
