import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { generateReporterCode, hashReporterCode } from '@agrivoice/core';
import type { AppEnv } from '../env';
import { ApiError, camelRow, nowIso, parse, parseBody, APPROVED_SQL } from '../lib/util';
import { COOKIE_NAME, SESSION_HOURS, signSession, verifyPassword, verifySession } from '../lib/auth';
import { hit, ipKey, peek } from '../lib/ratelimit';
import { RESOURCES, crudRoutes } from './admin-crud';
import { csvRoutes } from './admin-csv';

export const adminRoutes = new Hono<AppEnv>();

export async function audit(c: { env: AppEnv['Bindings']; get: (k: 'deps') => AppEnv['Variables']['deps'] }, action: string, entity: string, detail?: unknown) {
  await c.env.DB.prepare('INSERT INTO admin_audit (at, actor, action, entity, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(c.get('deps').now().toISOString(), 'admin', action, entity, detail === undefined ? null : JSON.stringify(detail).slice(0, 1000))
    .run();
}

// CSRF: every state-changing request needs a custom header the browser will not add cross-site.
adminRoutes.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.header('x-requested-with'))
    throw new ApiError(403, 'csrf', 'Missing X-Requested-With header');
  await next();
});

const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW = 900;

adminRoutes.post('/login', async (c) => {
  const now = c.get('deps').now();
  const key = await ipKey(c, 'admin-login');
  if ((await peek(c.env.DB, key, LOGIN_WINDOW, now)) >= LOGIN_MAX_FAILS)
    throw new ApiError(429, 'rate_limited', 'Too many failed attempts. Try again later.');
  const { password } = await parseBody(c, z.object({ password: z.string().min(1).max(200) }));
  let valid = false;
  try {
    const secret = c.env.SESSION_SECRET;
    valid = !!secret && (await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH));
  } catch {
    // e.g. the runtime refuses this many PBKDF2 iterations: say so without leaking anything
    throw new ApiError(500, 'hash_unsupported', 'The stored password hash cannot be verified here. See DEPLOY.md (admin hash iterations).');
  }
  if (!valid) {
    await hit(c.env.DB, key, LOGIN_WINDOW, now);
    throw new ApiError(401, 'invalid_credentials', 'Wrong password.');
  }
  setCookie(c, COOKIE_NAME, await signSession(c.env.SESSION_SECRET ?? '', now), {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
  await audit(c, 'login', 'session');
  return c.json({ ok: true });
});

adminRoutes.post('/logout', async (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/', secure: true });
  return c.json({ ok: true });
});

// everything below needs a valid session
adminRoutes.use('*', async (c, next) => {
  if (!(await verifySession(c.env.SESSION_SECRET, getCookie(c, COOKIE_NAME), c.get('deps').now())))
    throw new ApiError(401, 'unauthorized', 'Sign in required.');
  await next();
});

adminRoutes.get('/me', (c) => c.json({ admin: true }));

// ---- price moderation
adminRoutes.get('/prices', async (c) => {
  const status = c.req.query('status') ?? 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new ApiError(400, 'validation_error', 'status');
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.status, p.unit, p.price_ngn, p.reported_at, p.is_placeholder, m.name AS market, m.state, c.name_en AS crop, r.display_name AS reporter
     FROM price_reports p JOIN markets m ON m.id = p.market_id JOIN crops c ON c.id = p.crop_id LEFT JOIN reporters r ON r.id = p.reporter_id
     WHERE p.status = ? ORDER BY p.reported_at DESC LIMIT 500`,
  )
    .bind(status)
    .all<Record<string, unknown>>();
  return c.json({ prices: results.map(camelRow) });
});

async function moderate(c: Parameters<typeof nowIso>[0], id: number, status: 'approved' | 'rejected') {
  const r = await c.env.DB.prepare("UPDATE price_reports SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .bind(status, nowIso(c), id)
    .run();
  if (r.meta.changes === 0) throw new ApiError(404, 'not_found', 'No pending report with that id');
  await audit(c, status === 'approved' ? 'approve' : 'reject', 'price_report', { id });
}

adminRoutes.post('/prices/bulk-approve', async (c) => {
  const { ids } = await parseBody(c, z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }));
  for (const id of ids) await moderate(c, id, 'approved').catch((e) => {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  });
  return c.json({ ok: true });
});
adminRoutes.post('/prices/:id/approve', async (c) => {
  await moderate(c, parse(z.coerce.number().int().positive(), c.req.param('id')), 'approved');
  return c.json({ ok: true });
});
adminRoutes.post('/prices/:id/reject', async (c) => {
  await moderate(c, parse(z.coerce.number().int().positive(), c.req.param('id')), 'rejected');
  return c.json({ ok: true });
});

// ---- questions
adminRoutes.get('/questions', async (c) => {
  const status = c.req.query('status') ?? 'open';
  if (!['open', 'answered', 'closed'].includes(status)) throw new ApiError(400, 'validation_error', 'status');
  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.channel, q.language, q.text, q.contact, q.status, q.answer, q.created_at, q.answered_at, l.state, l.lga
     FROM questions q LEFT JOIN locations l ON l.id = q.location_id WHERE q.status = ? ORDER BY q.created_at DESC LIMIT 500`,
  )
    .bind(status)
    .all<Record<string, unknown>>();
  return c.json({ questions: results.map(camelRow) });
});
adminRoutes.post('/questions/:id/answer', async (c) => {
  const id = parse(z.coerce.number().int().positive(), c.req.param('id'));
  const { answer } = await parseBody(c, z.object({ answer: z.string().trim().min(1).max(2000) }));
  const r = await c.env.DB.prepare("UPDATE questions SET answer = ?, status = 'answered', answered_at = ? WHERE id = ?").bind(answer, nowIso(c), id).run();
  if (r.meta.changes === 0) throw new ApiError(404, 'not_found', 'Unknown question');
  await audit(c, 'answer', 'question', { id });
  return c.json({ ok: true });
});

// ---- deletion requests
adminRoutes.get('/deletion-requests', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM deletion_requests ORDER BY (status = \'open\') DESC, created_at DESC LIMIT 500').all<Record<string, unknown>>();
  return c.json({ requests: results.map(camelRow) });
});
adminRoutes.post('/deletion-requests/:id/done', async (c) => {
  const id = parse(z.coerce.number().int().positive(), c.req.param('id'));
  const r = await c.env.DB.prepare("UPDATE deletion_requests SET status = 'done', done_at = ? WHERE id = ?").bind(nowIso(c), id).run();
  if (r.meta.changes === 0) throw new ApiError(404, 'not_found', 'Unknown request');
  await audit(c, 'done', 'deletion_request', { id });
  return c.json({ ok: true });
});

// ---- reporters (code shown once)
adminRoutes.get('/reporters', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT r.id, r.display_name, r.market_id, r.active, r.created_at, m.name AS market FROM reporters r LEFT JOIN markets m ON m.id = r.market_id ORDER BY r.id',
  ).all<Record<string, unknown>>();
  return c.json({ items: results.map(camelRow) });
});
adminRoutes.post('/reporters', async (c) => {
  const b = await parseBody(c, z.object({ displayName: z.string().trim().min(1).max(80), marketId: z.number().int().positive().nullable().optional() }));
  const code = generateReporterCode();
  const hash = await hashReporterCode(code, c.env.REPORTER_PEPPER ?? '');
  const r = await c.env.DB.prepare('INSERT INTO reporters (code_hash, display_name, market_id, active, created_at) VALUES (?, ?, ?, 1, ?)')
    .bind(hash, b.displayName, b.marketId ?? null, nowIso(c))
    .run();
  await audit(c, 'create', 'reporters', { id: r.meta.last_row_id });
  return c.json({ id: r.meta.last_row_id, displayName: b.displayName, code }, 201);
});

// ---- dashboard + stats
export async function placeholderCounts(db: D1Database) {
  const n = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const counts = {
    briefs: await n('SELECT COUNT(*) AS n FROM briefs WHERE is_placeholder = 1'),
    qa: await n('SELECT COUNT(*) AS n FROM qa_items WHERE is_placeholder = 1'),
    alertAdvice: await n('SELECT COUNT(*) AS n FROM alert_advice WHERE is_placeholder = 1'),
    markets: await n('SELECT COUNT(*) AS n FROM markets WHERE is_placeholder = 1'),
    prices: await n('SELECT COUNT(*) AS n FROM price_reports WHERE is_placeholder = 1'),
    alertRulesNeedingReview: await n('SELECT COUNT(*) AS n FROM alert_rules WHERE needs_review = 1'),
  };
  return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

adminRoutes.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const n = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  return c.json({
    placeholders: await placeholderCounts(db),
    openQuestions: await n("SELECT COUNT(*) AS n FROM questions WHERE status = 'open'"),
    pendingPrices: await n("SELECT COUNT(*) AS n FROM price_reports WHERE status = 'pending'"),
    openDeletionRequests: await n("SELECT COUNT(*) AS n FROM deletion_requests WHERE status = 'open'"),
    unapprovedContent: await n(
      `SELECT (SELECT COUNT(*) FROM briefs b WHERE NOT (${APPROVED_SQL('b')})) + (SELECT COUNT(*) FROM qa_items b WHERE NOT (${APPROVED_SQL('b')})) AS n`,
    ),
  });
});

adminRoutes.get('/stats', async (c) => {
  const db = c.env.DB;
  const n = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const since = new Date(c.get('deps').now().getTime() - 30 * 86400_000).toISOString();
  const sessions = (
    await db
      .prepare("SELECT substr(at, 1, 10) AS day, channel, COUNT(*) AS n FROM events WHERE kind = 'session' AND at >= ? GROUP BY day, channel ORDER BY day")
      .bind(since)
      .all<{ day: string; channel: string; n: number }>()
  ).results;
  const registrations = (
    await db.prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM farmers WHERE created_at >= ? GROUP BY day ORDER BY day').bind(since).all<{ day: string; n: number }>()
  ).results;
  const menuUse = (
    await db.prepare("SELECT kind, COUNT(*) AS n FROM events WHERE kind <> 'session' GROUP BY kind ORDER BY n DESC").all<{ kind: string; n: number }>()
  ).results;
  return c.json({
    registeredFarmers: await n('SELECT COUNT(*) AS n FROM farmers'),
    registrationsByDay: registrations,
    sessionsByDayAndChannel: sessions,
    menuUse,
    pricesReported: await n('SELECT COUNT(*) AS n FROM price_reports WHERE reporter_id IS NOT NULL'),
    pricesApproved: await n("SELECT COUNT(*) AS n FROM price_reports WHERE status = 'approved' AND reporter_id IS NOT NULL"),
    questionsReceived: await n('SELECT COUNT(*) AS n FROM questions'),
    questionsAnswered: await n("SELECT COUNT(*) AS n FROM questions WHERE status = 'answered'"),
    placeholders: await placeholderCounts(db),
  });
});

adminRoutes.route('/', csvRoutes);
adminRoutes.route('/', crudRoutes(RESOURCES));
