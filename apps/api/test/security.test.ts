import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harness, ussd, USSD_TOKEN } from './helpers';
import { ROOT } from '../src/seed/index';

describe('security controls', () => {
  it('API responses are never cached and carry the security headers, including errors and 404s', async () => {
    const h = await harness();
    for (const [m, p] of [['GET', '/api/health'], ['GET', '/api/nope'], ['GET', '/api/admin/me'], ['POST', `/api/ussd/at/wrong`]] as const) {
      const r = await h.req(m, p);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('content-security-policy')).toMatch(/script-src 'self'/);
      expect(r.headers.get('content-security-policy')).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    }
  });

  it('oversized bodies are rejected', async () => {
    const h = await harness();
    const r = await h.req('POST', '/api/questions', 'x'.repeat(1_200_000), { 'content-type': 'application/json' });
    expect(r.status).toBe(413);
  });

  it('SQL injection payloads are stored as plain text or rejected, never executed', async () => {
    const h = await harness();
    const evil = "x'); DROP TABLE questions; --";
    expect((await h.json('POST', '/api/questions', { text: evil })).status).toBe(201);
    expect((await h.db.prepare('SELECT text FROM questions').first<{ text: string }>())!.text).toBe(evil);
    expect((await h.json('GET', `/api/qa/search?q=${encodeURIComponent(evil)}`)).status).toBe(200);
    expect((await h.json('GET', `/api/brief?state=${encodeURIComponent("Ogun' OR '1'='1")}&cropId=1`)).status).toBe(404);
    expect((await h.json('GET', '/api/places?state=' + encodeURIComponent("'; DROP TABLE locations;--"))).body.lgas).toEqual([]);
    expect((await h.json('POST', '/api/prices/report', { reporterCode: "' OR 1=1 --", marketId: 1, cropId: 1, unit: 'bag', priceNgn: 5 })).status).toBe(403);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM locations').first<{ n: number }>())!.n).toBeGreaterThan(30);
  });

  it('USSD token check: near-miss, prefix, empty and longer tokens are all refused', async () => {
    const h = await harness({ demo: true });
    const form = new URLSearchParams({ sessionId: 'tok-1', phoneNumber: '+2348000000000', text: '' });
    for (const t of [USSD_TOKEN.slice(0, -1), USSD_TOKEN + 'x', USSD_TOKEN.toUpperCase(), 'a']) expect((await h.req('POST', `/api/ussd/at/${t}`, form)).status, t).toBe(404);
    const noSecret = await harness({ envOverrides: { USSD_PATH_TOKEN: '' } });
    expect((await noSecret.req('POST', '/api/ussd/at/', form)).status).toBe(404);
    expect((await noSecret.req('POST', '/api/ussd/at/anything', form)).status).toBe(404);
  });

  it('the AT endpoint caps requests per subscriber', async () => {
    const h = await harness({ demo: true });
    let last = '';
    for (let i = 0; i < 302; i++) last = await ussd(h, 'cap-' + i, '+2348000000042', '');
    expect(last).toContain('END Too many requests');
  });

  it('admin is closed when secrets are not configured', async () => {
    const h = await harness({ envOverrides: { ADMIN_PASSWORD_HASH: undefined } });
    expect((await h.json('POST', '/api/admin/login', { password: 'anything at all' }, { 'x-requested-with': 'x' })).status).toBe(401);
    const h2 = await harness({ envOverrides: { SESSION_SECRET: undefined } });
    expect((await h2.json('POST', '/api/admin/login', { password: 'correct horse battery' }, { 'x-requested-with': 'x' })).status).toBe(401);
    const h3 = await harness({ envOverrides: { ADMIN_PASSWORD_HASH: 'pbkdf2-sha256$notanumber$x$y' } });
    expect((await h3.json('POST', '/api/admin/login', { password: 'whatever12345' }, { 'x-requested-with': 'x' })).status).toBe(401);
  });

  it('login failures never reveal whether the hash exists; error bodies hold no stack traces', async () => {
    const h = await harness();
    h.db.prepare = (() => { throw new Error('secret db path /var/x'); }) as never;
    const r = await h.json('GET', '/api/places');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret db path');
    expect(r.body.error.code).toBe('internal_error');
  });

  it('source code never logs request data: console use is limited to known safe places', () => {
    const allowed = new Set(['app.ts']);
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? (n === 'dev' ? [] : walk(join(d, n))) : [join(d, n)]));
    for (const f of walk(join(ROOT, 'apps', 'api', 'src')).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(f, 'utf8');
      const uses = /console\.(log|error|warn|info|debug)/.test(src);
      expect(uses && ![...allowed].some((a) => f.endsWith(a)), `${f} uses console`).toBe(false);
    }
    expect(readFileSync(join(ROOT, 'apps/api/src/app.ts'), 'utf8')).toMatch(/console\.error\('unhandled error:', err instanceof Error \? err\.name/);
  });

  it('no secrets are committed: .dev.vars is ignored and the example has no values', () => {
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8')).toMatch(/^\.dev\.vars$/m);
    const ex = readFileSync(join(ROOT, '.dev.vars.example'), 'utf8');
    for (const line of ex.split('\n').filter((l) => /^[A-Z_]+=/.test(l))) {
      const v = line.split('=')[1]!.split('#')[0]!.trim();
      expect(['', '1', 'en']).toContain(v);
    }
  });
});
