import { Hono } from 'hono';
import { z } from 'zod';
import { hashReporterCode } from '@agrivoice/core';
import type { AppEnv } from '../env';
import { ApiError, languages, nowIso, parse, parseBody } from '../lib/util';
import { limit } from '../lib/ratelimit';
import { getForecast, getLocation } from '../lib/forecast';
import { buildAlerts, latestBrief, latestPrices, listCrops, placeName, searchQa } from '../lib/content';

export const publicRoutes = new Hono<AppEnv>();

const lang = (c: { req: { query: (k: string) => string | undefined }; env: AppEnv['Bindings'] }) => {
  const l = c.req.query('lang') ?? 'en';
  return /^[a-z]{2,3}$/.test(l) ? l : 'en';
};
const intQ = z.coerce.number().int().positive();

publicRoutes.get('/health', (c) => c.json({ ok: true }));

publicRoutes.get('/places', async (c) => {
  const state = c.req.query('state');
  if (state) {
    const { results } = await c.env.DB.prepare('SELECT id, lga FROM locations WHERE state = ? AND lga IS NOT NULL ORDER BY lga')
      .bind(state)
      .all<{ id: number; lga: string }>();
    return c.json({ state, lgas: results.map((r) => ({ lga: r.lga, locationId: r.id })) });
  }
  const { results } = await c.env.DB.prepare('SELECT id, state FROM locations WHERE lga IS NULL ORDER BY state').all<{ id: number; state: string }>();
  return c.json({ states: results.map((r) => ({ state: r.state, locationId: r.id })) });
});

publicRoutes.get('/crops', async (c) => {
  return c.json({ crops: await listCrops(c.env.DB, lang(c)), languages: languages(c) });
});

async function loadLocation(c: Parameters<typeof nowIso>[0]) {
  const id = parse(intQ, c.req.query('locationId'));
  const loc = await getLocation(c.env.DB, id);
  if (!loc) throw new ApiError(404, 'not_found', 'Unknown location');
  return loc;
}

publicRoutes.get('/forecast', async (c) => {
  const loc = await loadLocation(c);
  const f = await getForecast(c.env, c.get('deps'), loc);
  return c.json({ ...f, days: f.days });
});

publicRoutes.get('/alerts', async (c) => {
  const loc = await loadLocation(c);
  const cropRaw = c.req.query('cropId');
  const cropId = cropRaw ? parse(intQ, cropRaw) : undefined;
  const f = await getForecast(c.env, c.get('deps'), loc);
  const alerts = await buildAlerts(c.env.DB, f.days, placeName(loc), cropId, lang(c));
  return c.json({ alerts, stale: f.stale, fetchedAt: f.fetchedAt });
});

publicRoutes.get('/brief', async (c) => {
  const state = parse(z.string().min(2).max(40), c.req.query('state'));
  const cropId = parse(intQ, c.req.query('cropId'));
  const row = await latestBrief(c.env.DB, state, cropId, lang(c));
  if (!row) throw new ApiError(404, 'no_brief', 'No approved brief yet for this state and crop.');
  return c.json({
    id: row.id,
    state: row.state,
    cropId: row.crop_id,
    language: row.language,
    weekStart: row.week_start,
    title: row.title,
    body: row.body,
    ussdSummary: row.ussd_summary,
    audioUrl: row.audio_url,
    reviewer: row.reviewer,
    approvedAt: row.approved_at,
    isPlaceholder: !!row.is_placeholder,
  });
});

publicRoutes.get('/markets', async (c) => {
  const state = c.req.query('state');
  const { results } = state
    ? await c.env.DB.prepare('SELECT id, name, state, lga, is_placeholder FROM markets WHERE state = ? ORDER BY name').bind(state).all<Record<string, unknown>>()
    : await c.env.DB.prepare('SELECT id, name, state, lga, is_placeholder FROM markets ORDER BY state, name').all<Record<string, unknown>>();
  return c.json({
    markets: results.map((m) => ({ id: m.id, name: m.name, state: m.state, lga: m.lga, isPlaceholder: !!m.is_placeholder })),
  });
});

publicRoutes.get('/prices', async (c) => {
  const q = z
    .object({ cropId: intQ.optional(), state: z.string().max(40).optional(), marketId: intQ.optional() })
    .parse({
      cropId: c.req.query('cropId') || undefined,
      state: c.req.query('state') || undefined,
      marketId: c.req.query('marketId') || undefined,
    });
  const prices = await latestPrices(c.env.DB, c.get('deps').now(), q);
  return c.json({ prices });
});

const reportSchema = z.object({
  reporterCode: z.string().trim().min(4).max(16),
  marketId: z.number().int().positive(),
  cropId: z.number().int().positive(),
  unit: z.string().trim().min(1).max(20),
  priceNgn: z.number().int().positive().max(100_000_000),
});

publicRoutes.post('/prices/report', async (c) => {
  const body = await parseBody(c, reportSchema);
  const pepper = c.env.REPORTER_PEPPER ?? '';
  const hash = await hashReporterCode(body.reporterCode, pepper);
  await limit(c, 'price-report', 30, 3600, hash.slice(0, 16));
  const reporter = await c.env.DB.prepare('SELECT id FROM reporters WHERE code_hash = ? AND active = 1').bind(hash).first<{ id: number }>();
  if (!reporter) throw new ApiError(403, 'invalid_code', 'Agent code not recognised.');
  const market = await c.env.DB.prepare('SELECT id FROM markets WHERE id = ?').bind(body.marketId).first();
  const crop = await c.env.DB.prepare('SELECT id FROM crops WHERE id = ?').bind(body.cropId).first();
  if (!market || !crop) throw new ApiError(400, 'validation_error', 'Unknown market or crop');
  const r = await c.env.DB.prepare(
    "INSERT INTO price_reports (market_id, crop_id, unit, price_ngn, reported_at, reporter_id, status, is_placeholder) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)",
  )
    .bind(body.marketId, body.cropId, body.unit, body.priceNgn, nowIso(c), reporter.id)
    .run();
  return c.json({ id: r.meta.last_row_id, status: 'pending' }, 201);
});

publicRoutes.get('/qa/search', async (c) => {
  const q = parse(z.string().trim().min(2).max(200), c.req.query('q'));
  const cropRaw = c.req.query('cropId');
  const matches = await searchQa(c.env.DB, q, lang(c), cropRaw ? parse(intQ, cropRaw) : undefined);
  return c.json({ matches });
});

const questionSchema = z.object({
  text: z.string().trim().min(3).max(500),
  language: z.string().regex(/^[a-z]{2,3}$/).default('en'),
  locationId: z.number().int().positive().optional(),
  contact: z.string().trim().max(30).optional(),
  consentContact: z.boolean().default(false),
});

publicRoutes.post('/questions', async (c) => {
  await limit(c, 'questions', 10, 3600);
  const b = await parseBody(c, questionSchema);
  if (b.contact && !/^[+\d][\d\s-]{5,}$/.test(b.contact)) throw new ApiError(400, 'validation_error', 'contact: not a phone number');
  const contact = b.consentContact && b.contact ? b.contact : null;
  const r = await c.env.DB.prepare(
    "INSERT INTO questions (channel, language, text, location_id, contact, status, created_at) VALUES ('web', ?, ?, ?, ?, 'open', ?)",
  )
    .bind(b.language, b.text, b.locationId ?? null, contact, nowIso(c))
    .run();
  return c.json({ id: r.meta.last_row_id, status: 'open' }, 201);
});

publicRoutes.post('/privacy/delete-request', async (c) => {
  await limit(c, 'delete-request', 5, 3600);
  const b = await parseBody(c, z.object({ note: z.string().trim().max(500).optional(), contact: z.string().trim().max(100).optional() }));
  const r = await c.env.DB.prepare("INSERT INTO deletion_requests (note, contact, status, created_at) VALUES (?, ?, 'open', ?)")
    .bind(b.note ?? null, b.contact ?? null, nowIso(c))
    .run();
  return c.json({ id: r.meta.last_row_id, status: 'open' }, 201);
});

publicRoutes.get('/stats/public', async (c) => {
  const db = c.env.DB;
  const n = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  return c.json({
    registeredFarmers: await n('SELECT COUNT(*) AS n FROM farmers'),
    ussdSessions: await n("SELECT COUNT(*) AS n FROM events WHERE kind = 'session' AND channel = 'ussd'"),
    simulatorSessions: await n("SELECT COUNT(*) AS n FROM events WHERE kind = 'session' AND channel = 'sim'"),
    approvedPriceReports: await n("SELECT COUNT(*) AS n FROM price_reports WHERE status = 'approved'"),
    questionsAnswered: await n("SELECT COUNT(*) AS n FROM questions WHERE status = 'answered'"),
  });
});
