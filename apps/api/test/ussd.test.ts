import { describe, expect, it } from 'vitest';
import { hashPhone } from '@agrivoice/core';
import { forecastJson, harness, ussd, NOW, USSD_TOKEN } from './helpers';

const PHONE = '+2348011111111';

describe('USSD endpoints (Africa\'s Talking replay)', () => {
  it('wrong or missing token returns 404; text/plain CON/END replies', async () => {
    const h = await harness({ demo: true });
    const form = new URLSearchParams({ sessionId: 'x1234', phoneNumber: PHONE, text: '' });
    expect((await h.req('POST', '/api/ussd/at/wrong-token', form)).status).toBe(404);
    expect((await h.req('POST', '/api/ussd/at/', form)).status).toBe(404);
    const ok = await h.req('POST', `/api/ussd/at/${USSD_TOKEN}`, form);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/plain');
    expect(await ok.text()).toMatch(/^CON /);
    const bad = await h.req('POST', `/api/ussd/at/${USSD_TOKEN}`, new URLSearchParams({ sessionId: 'x', phoneNumber: 'abc', text: '' }));
    expect(bad.status).toBe(400);
  });

  it('full first-time session with cumulative text, consent yes, then menu items', async () => {
    const h = await harness({ demo: true });
    h.setForecast(() => Response.json(forecastJson([0, 0, 60, 0, 0, 0, 0])));
    const sid = 'AT-1000';
    let text = '';
    const send = async (input: string) => {
      text = text ? `${text}*${input}` : input;
      return ussd(h, sid, PHONE, text);
    };
    expect(await ussd(h, sid, PHONE, '')).toContain('Select state');
    // Ogun is the 28th state alphabetically with FCT: find it by paging
    let screen = '';
    const states = (await h.json('GET', '/api/places')).body.states.map((s: { state: string }) => s.state) as string[];
    const idx = states.indexOf('Ogun');
    for (let p = 0; p < Math.floor(idx / 6); p++) screen = await send('7');
    screen = await send(String((idx % 6) + 1));
    expect(screen).toContain('Select LGA');
    screen = await send('2'); // Ifo
    expect(screen).toContain('Select crop');
    screen = await send('1'); // first crop with content
    expect(screen).toContain('Save your place and crop?');
    screen = await send('1');
    expect(screen).toContain('1 Farm brief');
    // farmer stored with hash only
    const f = (await h.db.prepare('SELECT * FROM farmers').all<Record<string, unknown>>()).results;
    expect(f).toHaveLength(1);
    expect(f[0]!.phone_hash).toBe(await hashPhone(PHONE, h.env.PHONE_HASH_SECRET!));
    expect(JSON.stringify(f)).not.toContain('8011111111');
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM consents').first<{ n: number }>())!.n).toBe(1);

    expect(await send('1')).toContain('DEMO:');
    expect(await send('0')).toContain('Farm brief');
    expect(await send('2')).toMatch(/Heavy rain forecast for Ifo/);
    expect(await send('0')).toContain('Weather and alerts');
    const prices = await send('3');
    expect(prices).toContain('Prices for:');
    expect(await send('1')).toContain('DEMO:');
    expect(await send('00')).toContain('AgriVoice');
  });

  it('returning farmer skips onboarding; sessions expire after 5 minutes', async () => {
    const h = await harness({ demo: true });
    // register directly
    const loc = (await h.db.prepare("SELECT id FROM locations WHERE lga = 'Ifo'").first<{ id: number }>())!.id;
    await h.db
      .prepare("INSERT INTO farmers (phone_hash, language, location_id, crop_ids_json, created_at) VALUES (?, 'en', ?, '[1]', 'x')")
      .bind(await hashPhone(PHONE, h.env.PHONE_HASH_SECRET!), loc)
      .run();
    const first = await ussd(h, 'S-100', PHONE, '');
    expect(first).toContain('1 Farm brief');
    expect(await ussd(h, 'S-100', PHONE, '5')).toContain('Settings');
    h.setNow(new Date(NOW.getTime() + 6 * 60_000));
    // text continues "5*1" but the session expired: start again at the menu
    expect(await ussd(h, 'S-100', PHONE, '5*1')).toContain('1 Farm brief');
  });

  it('delete my data removes the farmer and consents; call-back stores contact only with consent', async () => {
    const h = await harness({ demo: true });
    const loc = (await h.db.prepare("SELECT id FROM locations WHERE lga = 'Ifo'").first<{ id: number }>())!.id;
    const hash = await hashPhone(PHONE, h.env.PHONE_HASH_SECRET!);
    await h.db.prepare("INSERT INTO farmers (phone_hash, language, location_id, crop_ids_json, created_at) VALUES (?, 'en', ?, '[1]', 'x')").bind(hash, loc).run();
    await h.db.prepare("INSERT INTO consents (farmer_id, purpose, given_at) VALUES (1, 'profile', 'x')").run();
    await ussd(h, 'D-1', PHONE, '');
    await ussd(h, 'D-1', PHONE, '5');
    await ussd(h, 'D-1', PHONE, '5*3');
    const done = await ussd(h, 'D-1', PHONE, '5*3*1');
    expect(done).toMatch(/^END .*deleted/);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM farmers').first<{ n: number }>())!.n).toBe(0);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM consents').first<{ n: number }>())!.n).toBe(0);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM ussd_sessions').first<{ n: number }>())!.n).toBe(0);
  });

  it('call-back: consent yes stores the number, no stores none', async () => {
    const h = await harness({ demo: true });
    const loc = (await h.db.prepare("SELECT id FROM locations WHERE lga = 'Ifo'").first<{ id: number }>())!.id;
    await h.db.prepare("INSERT INTO farmers (phone_hash, language, location_id, crop_ids_json, created_at) VALUES (?, 'en', ?, '[1]', 'x')").bind(await hashPhone(PHONE, h.env.PHONE_HASH_SECRET!), loc).run();
    const run = async (sid: string, answer: string) => {
      await ussd(h, sid, PHONE, '');
      await ussd(h, sid, PHONE, '4');
      await ussd(h, sid, PHONE, '4*6');
      await ussd(h, sid, PHONE, '4*6*2');
      return ussd(h, sid, PHONE, `4*6*2*${answer}`);
    };
    expect(await run('C-1', '1')).toMatch(/^END /);
    expect(await run('C-2', '2')).toMatch(/^END /);
    const rows = (await h.db.prepare('SELECT channel, text, contact FROM questions ORDER BY id').all<{ channel: string; text: string; contact: string | null }>()).results;
    expect(rows).toEqual([
      { channel: 'ussd', text: 'Call-back topic: Pests or disease', contact: PHONE },
      { channel: 'ussd', text: 'Call-back topic: Pests or disease', contact: null },
    ]);
  });

  it('events carry no personal data; simulator works with JSON and is rate limited', async () => {
    const h = await harness({ demo: true });
    const r = await h.json('POST', '/api/ussd/sim', { sessionId: 'sim-abc1', phone: '+2340000000001', text: '' });
    expect(r.status).toBe(200);
    expect(r.body.end).toBe(false);
    expect(r.body.text).toMatch(/^CON /);
    const ev = (await h.db.prepare('SELECT * FROM events').all<Record<string, unknown>>()).results;
    expect(ev[0]).toMatchObject({ channel: 'sim', kind: 'session' });
    expect(Object.keys(ev[0]!).sort()).toEqual(['at', 'channel', 'id', 'kind', 'state']);
    expect((await h.json('POST', '/api/ussd/sim', { sessionId: 'x', phone: 'bad', text: '' })).status).toBe(400);
    let status = 0;
    for (let i = 0; i < 245; i++) status = (await h.json('POST', '/api/ussd/sim', { sessionId: 'sim-abc2', phone: '+2340000000001', text: '' })).status;
    expect(status).toBe(429);
  });

  it('never writes phone numbers to logs', async () => {
    const h = await harness({ demo: true });
    const logs: string[] = [];
    const [oLog, oErr, oWarn] = [console.log, console.error, console.warn];
    console.log = console.error = console.warn = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      await ussd(h, 'L-1', PHONE, '');
      await ussd(h, 'L-1', PHONE, '99');
    } finally {
      console.log = oLog;
      console.error = oErr;
      console.warn = oWarn;
    }
    expect(logs.join('\n')).not.toContain('8011111111');
  });
});
