import { describe, expect, it } from 'vitest';
import { harness, forecastJson, NOW } from './helpers';

async function loc(h: Awaited<ReturnType<typeof harness>>) {
  return (await h.db.prepare("SELECT id FROM locations WHERE lga = 'Ifo'").first<{ id: number }>())!.id;
}

describe('forecast and alerts', () => {
  it('fetches from Open-Meteo with the expected query and caches for 3 hours', async () => {
    const h = await harness();
    const id = await loc(h);
    const a = await h.json('GET', `/api/forecast?locationId=${id}`);
    expect(a.status).toBe(200);
    expect(a.body.days).toHaveLength(7);
    expect(a.body.source).toBe('open-meteo');
    expect(a.body.stale).toBe(false);
    expect(a.body.days[0]).toEqual({ date: '2026-11-14', precipMm: 0, tmaxC: 30, tminC: 21, popPct: 40 });
    const url = new URL(h.fetchCalls[0]!);
    expect(url.hostname).toBe('api.open-meteo.com');
    expect(url.searchParams.get('daily')).toBe('precipitation_sum,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
    expect(url.searchParams.get('timezone')).toBe('Africa/Lagos');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    await h.json('GET', `/api/forecast?locationId=${id}`);
    expect(h.fetchCalls).toHaveLength(1);
    h.setNow(new Date(NOW.getTime() + 2.9 * 3600_000));
    await h.json('GET', `/api/forecast?locationId=${id}`);
    expect(h.fetchCalls).toHaveLength(1);
    h.setNow(new Date(NOW.getTime() + 3.1 * 3600_000));
    await h.json('GET', `/api/forecast?locationId=${id}`);
    expect(h.fetchCalls).toHaveLength(2);
  });

  it('serves stale cache when the refresh fails', async () => {
    const h = await harness();
    const id = await loc(h);
    await h.json('GET', `/api/forecast?locationId=${id}`);
    h.setForecast(null);
    h.setNow(new Date(NOW.getTime() + 5 * 3600_000));
    const r = await h.json('GET', `/api/forecast?locationId=${id}`);
    expect(r.status).toBe(200);
    expect(r.body.stale).toBe(true);
    expect(r.body.fetchedAt).toBe(NOW.toISOString());
  });

  it('fails clearly without cache outside demo mode, uses fixture in demo mode', async () => {
    const h = await harness();
    h.setForecast(() => new Response('boom', { status: 500 }));
    const id = await loc(h);
    const r = await h.json('GET', `/api/forecast?locationId=${id}`);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('forecast_unavailable');
    const d = await harness({ envOverrides: { DEMO_MODE: '1' } });
    d.setForecast(null);
    const ok = await d.json('GET', `/api/forecast?locationId=${await loc(d)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.source).toBe('demo-fixture');
    expect(ok.body.isPlaceholder).toBe(true);
    expect(ok.body.days).toHaveLength(7);
  });

  it('rejects bad payloads and unknown locations', async () => {
    const h = await harness();
    h.setForecast(() => Response.json({ nope: true }));
    expect((await h.json('GET', `/api/forecast?locationId=${await loc(h)}`)).status).toBe(503);
    expect((await h.json('GET', '/api/forecast?locationId=999999')).status).toBe(404);
  });

  it('alerts: flagged unconfirmed, no advice unless approved', async () => {
    const h = await harness();
    h.setForecast(() => Response.json(forecastJson([0, 0, 50, 0, 0, 0, 0])));
    const id = await loc(h);
    const maize = (await h.db.prepare("SELECT id FROM crops WHERE slug='maize'").first<{ id: number }>())!.id;
    const r = await h.json('GET', `/api/alerts?locationId=${id}&cropId=${maize}`);
    const a = r.body.alerts.find((x: { ruleKey: string }) => x.ruleKey === 'heavy_rain');
    expect(a.message).toBe('Heavy rain forecast for Ifo on 16 Nov: 50 mm');
    expect(a.needsReview).toBe(true);
    expect(a.unconfirmedLabel).toBe('Unconfirmed threshold');
    expect(a.advice).toBeNull();
    // draft advice is not shown; approved advice is
    await h.db.prepare("INSERT INTO alert_advice (rule_key, crop_id, language, text, reviewer, approved_at, status) VALUES ('heavy_rain', NULL, 'en', 'draft text', 'R', 'x', 'draft')").run();
    expect((await h.json('GET', `/api/alerts?locationId=${id}`)).body.alerts[0].advice).toBeNull();
    await h.db.prepare("INSERT INTO alert_advice (rule_key, crop_id, language, text, reviewer, approved_at, status, is_placeholder) VALUES ('heavy_rain', ?, 'en', 'approved text', 'R', 'x', 'approved', 1)").bind(maize).run();
    const ok = (await h.json('GET', `/api/alerts?locationId=${id}&cropId=${maize}`)).body.alerts.find((x: { ruleKey: string }) => x.ruleKey === 'heavy_rain');
    expect(ok.advice).toBe('approved text');
    expect(ok.isPlaceholder).toBe(true);
  });

  it('alert threshold boundaries at the API level (49 no, 50 yes)', async () => {
    const h = await harness();
    const id = await loc(h);
    h.setForecast(() => Response.json(forecastJson([0, 49.9, 0, 0, 0, 0, 0])));
    expect((await h.json('GET', `/api/alerts?locationId=${id}`)).body.alerts.some((x: { ruleKey: string }) => x.ruleKey === 'heavy_rain')).toBe(false);
  });
});
