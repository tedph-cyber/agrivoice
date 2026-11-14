import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '@agrivoice/core';
import { harness } from './helpers';
import { ROOT } from '../src/seed/index';

const tpl = (n: string) => readFileSync(join(ROOT, 'content-templates', n), 'utf8');
const H = (cookie: string) => ({ cookie, 'x-requested-with': 'test', 'content-type': 'text/csv' });
async function imp(h: Awaited<ReturnType<typeof harness>>, type: string, csv: string, mode = '') {
  if (!h.cookie) await h.login();
  const res = await h.app.request(`/api/admin/import/${type}${mode ? `?mode=${mode}` : ''}`, { method: 'POST', headers: H(h.cookie), body: csv }, h.env);
  return { status: res.status, body: await res.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('csv parser', () => {
  it('handles quotes, commas, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n1,\r\n');
    expect(rows).toEqual([{ a: 'x, y', b: 'say "hi"' }, { a: '1', b: '' }]);
    expect(toCsv(['a', 'b'], [{ a: 'x, y', b: 'say "hi"' }])).toBe('a,b\n"x, y","say ""hi"""\n');
  });
});

describe('CSV import and export', () => {
  it('imports every template that is valid as-is, keeping is_placeholder', async () => {
    const h = await harness();
    for (const [type, file] of [['crops', 'crops.csv'], ['alert-rules', 'alert_rules.csv'], ['markets', 'markets.csv'], ['briefs', 'briefs.csv'], ['qa', 'qa.csv'], ['alert-advice', 'alert_advice.csv']] as const) {
      const r = await imp(h, type, tpl(file));
      expect(r.status, `${type}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.errors).toEqual([]);
    }
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM briefs WHERE is_placeholder = 1').first<{ n: number }>())!.n).toBeGreaterThan(0);
    expect((await h.json('GET', '/api/brief?state=Ogun&cropId=1')).status).toBe(200);
  });

  it('is idempotent: importing twice does not duplicate', async () => {
    const h = await harness();
    await imp(h, 'markets', tpl('markets.csv'));
    await imp(h, 'markets', tpl('markets.csv'));
    await imp(h, 'qa', tpl('qa.csv'));
    await imp(h, 'qa', tpl('qa.csv'));
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM markets').first<{ n: number }>())!.n).toBe(2);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM qa_items').first<{ n: number }>())!.n).toBe(2);
  });

  it('locations template has blank coordinates: all-or-nothing applies nothing, skip-invalid applies valid rows', async () => {
    const h = await harness();
    const before = (await h.db.prepare('SELECT COUNT(*) AS n FROM locations').first<{ n: number }>())!.n;
    const r = await imp(h, 'locations', tpl('locations.csv'));
    expect(r.status).toBe(422);
    expect(r.body.applied).toBe(false);
    expect(r.body.errors[0]).toMatchObject({ row: 2 });
    expect(r.body.errors[0].message).toContain('lat is required');
    const mixed = tpl('locations.csv') + 'Ogun,Test LGA,7.1,3.2,csv\n';
    const bad = await imp(h, 'locations', mixed);
    expect(bad.status).toBe(422);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM locations').first<{ n: number }>())!.n).toBe(before);
    const ok = await imp(h, 'locations', mixed, 'skip-invalid');
    expect(ok.status).toBe(200);
    expect(ok.body.imported).toBe(1);
    expect(ok.body.skipped).toBe(2);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM locations').first<{ n: number }>())!.n).toBe(before + 1);
  });

  it('row-level errors: unknown crop, approved without reviewer, bad dates, bad header, too large', async () => {
    const h = await harness();
    await imp(h, 'crops', tpl('crops.csv'));
    const head = 'state,crop_slug,language,week_start,title,body,ussd_summary,audio_url,reviewer,approved_at,status,is_placeholder\n';
    const csv = head +
      'Ogun,rice,en,2026-11-16,T,B,,,,,draft,0\n' +
      'Ogun,maize,en,2026-11-16,T,B,,,,,approved,0\n' +
      'Ogun,maize,en,16-11-2026,T,B,,,,,draft,0\n' +
      'Ogun,maize,en,2026-11-16,T,B,,javascript:x,,,draft,0\n' +
      `Ogun,maize,en,2026-11-16,T,B,${'x'.repeat(141)},,,,draft,0\n`;
    const r = await imp(h, 'briefs', csv);
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: { message: string }) => e.message)).toEqual([
      'unknown crop_slug "rice"',
      'reviewer is required when status is approved',
      'week_start must be YYYY-MM-DD',
      'audio_url must be /audio/<file> or an https URL',
      'ussd_summary is too long (max 140)',
    ]);
    expect((await imp(h, 'briefs', 'state,title\nOgun,T\n')).status).toBe(400);
    expect((await imp(h, 'briefs', 'x'.repeat(1_000_001))).status).toBe(400);
    expect((await imp(h, 'nope', 'a\n1')).status).toBe(404);
    expect((await imp(h, 'briefs', '', '')).status).toBe(400);
    expect((await imp(h, 'briefs', head, 'weird')).status).toBe(400);
  });

  it('alert rules: clearing needs_review via CSV needs a reviewer', async () => {
    const h = await harness();
    const head = 'key,metric,operator,threshold,window_days,severity,enabled,needs_review';
    expect((await imp(h, 'alert-rules', `${head}\nheavy_rain,precip_day_mm,>=,60,3,warning,1,0\n`)).status).toBe(422);
    const ok = await imp(h, 'alert-rules', `${head},reviewer\nheavy_rain,precip_day_mm,>=,60,3,warning,1,0,Agronomist X\n`);
    expect(ok.status).toBe(200);
    expect((await h.db.prepare("SELECT threshold, needs_review FROM alert_rules WHERE key = 'heavy_rain'").first())).toEqual({ threshold: 60, needs_review: 0 });
  });

  it('exports the same columns and round-trips; formula cells are neutralised', async () => {
    const h = await harness({ demo: true });
    await h.admin('POST', '/markets', { name: '=HYPERLINK("x")', state: 'Ogun' });
    if (!h.cookie) await h.login();
    const res = await h.app.request('/api/admin/export/markets', { headers: { cookie: h.cookie } }, h.env);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text.split('\n')[0]).toBe('name,state,lga,lat,lon,is_placeholder');
    expect(text).toContain("'=HYPERLINK");
    const briefs = await (await h.app.request('/api/admin/export/briefs', { headers: { cookie: h.cookie } }, h.env)).text();
    expect(briefs.split('\n')[0]).toBe(tpl('briefs.csv').split('\n')[0]);
    const r = await imp(h, 'briefs', briefs);
    expect(r.status).toBe(200);
    expect((await h.json('GET', '/api/admin/export/briefs')).status).toBe(401);
  });

  it('writes an audit row', async () => {
    const h = await harness();
    await imp(h, 'crops', tpl('crops.csv'));
    expect((await h.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'import'").first<{ n: number }>())!.n).toBe(1);
  });
});
