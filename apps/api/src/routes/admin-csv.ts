import { Hono } from 'hono';
import { parseCsv, toCsv } from '@agrivoice/core';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/util';
import type { Stmt } from '../seed/index';
import { audit } from './admin';

export const csvRoutes = new Hono<AppEnv>();

export const IMPORT_TYPES = ['crops', 'locations', 'markets', 'briefs', 'qa', 'alert-rules', 'alert-advice'] as const;
type ImportType = (typeof IMPORT_TYPES)[number];
const MAX_BYTES = 1_000_000;
const MAX_ROWS = 5000;

class RowError extends Error {}

interface Ctx {
  crops: Map<string, number>;
  rules: Set<string>;
  now: string;
}
type Row = Record<string, string>;

const req = (r: Row, k: string, max = 5000): string => {
  const v = (r[k] ?? '').trim();
  if (!v) throw new RowError(`${k} is required`);
  if (v.length > max) throw new RowError(`${k} is too long (max ${max})`);
  return v;
};
const opt = (r: Row, k: string, max = 5000): string | null => {
  const v = (r[k] ?? '').trim();
  if (v.length > max) throw new RowError(`${k} is too long (max ${max})`);
  return v === '' ? null : v;
};
const numOf = (r: Row, k: string, lo: number, hi: number, required = true): number | null => {
  const v = (r[k] ?? '').trim();
  if (v === '') {
    if (required) throw new RowError(`${k} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new RowError(`${k} must be a number between ${lo} and ${hi}`);
  return n;
};
const flag = (r: Row, k: string, dflt: number): number => {
  const v = (r[k] ?? '').trim();
  if (v === '') return dflt;
  if (v !== '0' && v !== '1') throw new RowError(`${k} must be 0 or 1`);
  return Number(v);
};
const oneOf = <T extends string>(r: Row, k: string, allowed: readonly T[], dflt?: T): T => {
  const v = (r[k] ?? '').trim() || dflt;
  if (!v || !allowed.includes(v as T)) throw new RowError(`${k} must be one of ${allowed.join(', ')}`);
  return v as T;
};
const langOf = (r: Row): string => {
  const v = (r.language ?? '').trim() || 'en';
  if (!/^[a-z]{2,3}$/.test(v)) throw new RowError('language must be a 2-3 letter code');
  return v;
};
const cropOf = (r: Row, ctx: Ctx, required: boolean): number | null => {
  const slug = (r.crop_slug ?? '').trim();
  if (!slug) {
    if (required) throw new RowError('crop_slug is required');
    return null;
  }
  const id = ctx.crops.get(slug);
  if (!id) throw new RowError(`unknown crop_slug "${slug}"`);
  return id;
};
function approval(r: Row, ctx: Ctx) {
  const status = oneOf(r, 'status', ['draft', 'approved', 'archived'] as const, 'draft');
  const reviewer = opt(r, 'reviewer', 80);
  let approvedAt = opt(r, 'approved_at', 40);
  if (approvedAt && Number.isNaN(Date.parse(approvedAt))) throw new RowError('approved_at must be an ISO date-time');
  if (status === 'approved') {
    if (!reviewer) throw new RowError('reviewer is required when status is approved');
    approvedAt ??= ctx.now;
  }
  return { status, reviewer, approvedAt, isPlaceholder: flag(r, 'is_placeholder', 0) };
}

interface Importer {
  columns: string[];
  build(r: Row, ctx: Ctx): Stmt[];
  exportSql: string;
}

const IMPORTERS: Record<ImportType, Importer> = {
  crops: {
    columns: ['slug', 'name_en', 'name_pcm', 'name_ha', 'name_yo', 'name_ig'],
    exportSql: 'SELECT slug, name_en, names_json FROM crops ORDER BY slug',
    build(r) {
      const slug = req(r, 'slug', 40);
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new RowError('slug must be lowercase letters, digits or dashes');
      const names: Record<string, string> = {};
      for (const l of ['pcm', 'ha', 'yo', 'ig']) {
        const v = opt(r, `name_${l}`, 60);
        if (v) names[l] = v;
      }
      return [{ sql: 'INSERT INTO crops (slug, name_en, names_json) VALUES (?,?,?) ON CONFLICT(slug) DO UPDATE SET name_en = excluded.name_en, names_json = excluded.names_json', params: [slug, req(r, 'name_en', 60), JSON.stringify(names)] }];
    },
  },
  locations: {
    columns: ['state', 'lga', 'lat', 'lon', 'source'],
    exportSql: 'SELECT state, lga, lat, lon, source FROM locations ORDER BY state, lga',
    build(r) {
      const state = req(r, 'state', 40);
      const lga = opt(r, 'lga', 60);
      const lat = numOf(r, 'lat', -90, 90)!;
      const lon = numOf(r, 'lon', -180, 180)!;
      const source = opt(r, 'source', 80) ?? 'csv';
      if (lga === null)
        return [
          { sql: 'UPDATE locations SET lat = ?, lon = ?, source = ? WHERE state = ? AND lga IS NULL', params: [lat, lon, source, state] },
          { sql: 'INSERT INTO locations (state, lga, lat, lon, source) SELECT ?, NULL, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM locations WHERE state = ? AND lga IS NULL)', params: [state, lat, lon, source, state] },
        ];
      return [{ sql: 'INSERT INTO locations (state, lga, lat, lon, source) VALUES (?,?,?,?,?) ON CONFLICT(state, lga) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, source = excluded.source', params: [state, lga, lat, lon, source] }];
    },
  },
  markets: {
    columns: ['name', 'state', 'lga', 'lat', 'lon', 'is_placeholder'],
    exportSql: 'SELECT name, state, lga, lat, lon, is_placeholder FROM markets ORDER BY state, name',
    build(r) {
      const name = req(r, 'name', 100);
      const state = req(r, 'state', 40);
      const vals = [opt(r, 'lga', 60), numOf(r, 'lat', -90, 90, false), numOf(r, 'lon', -180, 180, false), flag(r, 'is_placeholder', 0)];
      return [
        { sql: 'UPDATE markets SET lga = ?, lat = ?, lon = ?, is_placeholder = ? WHERE name = ? AND state = ?', params: [...vals, name, state] },
        { sql: 'INSERT INTO markets (name, state, lga, lat, lon, is_placeholder) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM markets WHERE name = ? AND state = ?)', params: [name, state, ...vals, name, state] },
      ];
    },
  },
  briefs: {
    columns: ['state', 'crop_slug', 'language', 'week_start', 'title', 'body', 'ussd_summary', 'audio_url', 'reviewer', 'approved_at', 'status', 'is_placeholder'],
    exportSql: `SELECT b.state, c.slug AS crop_slug, b.language, b.week_start, b.title, b.body, b.ussd_summary, b.audio_url, b.reviewer, b.approved_at, b.status, b.is_placeholder FROM briefs b JOIN crops c ON c.id = b.crop_id ORDER BY b.week_start DESC, b.state, c.slug`,
    build(r, ctx) {
      const state = req(r, 'state', 40);
      const cropId = cropOf(r, ctx, true)!;
      const language = langOf(r);
      const week = req(r, 'week_start', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(Date.parse(week))) throw new RowError('week_start must be YYYY-MM-DD');
      const summary = opt(r, 'ussd_summary', 140);
      const audio = opt(r, 'audio_url', 500);
      if (audio && !/^(\/audio\/[\w.-]+|https:\/\/\S+)$/.test(audio)) throw new RowError('audio_url must be /audio/<file> or an https URL');
      const a = approval(r, ctx);
      const vals = [req(r, 'title', 200), req(r, 'body', 5000), summary, audio, a.reviewer, a.approvedAt, a.status, a.isPlaceholder];
      return [
        { sql: 'UPDATE briefs SET title = ?, body = ?, ussd_summary = ?, audio_url = ?, reviewer = ?, approved_at = ?, status = ?, is_placeholder = ? WHERE state = ? AND crop_id = ? AND language = ? AND week_start = ?', params: [...vals, state, cropId, language, week] },
        { sql: 'INSERT INTO briefs (state, crop_id, language, week_start, title, body, ussd_summary, audio_url, reviewer, approved_at, status, is_placeholder) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM briefs WHERE state = ? AND crop_id = ? AND language = ? AND week_start = ?)', params: [state, cropId, language, week, ...vals, state, cropId, language, week] },
      ];
    },
  },
  qa: {
    columns: ['crop_slug', 'language', 'question', 'answer', 'keywords', 'reviewer', 'approved_at', 'status', 'is_placeholder'],
    exportSql: `SELECT c.slug AS crop_slug, q.language, q.question, q.answer, q.keywords, q.reviewer, q.approved_at, q.status, q.is_placeholder FROM qa_items q LEFT JOIN crops c ON c.id = q.crop_id ORDER BY q.id`,
    build(r, ctx) {
      const cropId = cropOf(r, ctx, false);
      const language = langOf(r);
      const question = req(r, 'question', 300);
      const a = approval(r, ctx);
      const vals = [req(r, 'answer', 3000), opt(r, 'keywords', 300) ?? '', a.reviewer, a.approvedAt, a.status, a.isPlaceholder];
      return [
        { sql: 'UPDATE qa_items SET answer = ?, keywords = ?, reviewer = ?, approved_at = ?, status = ?, is_placeholder = ? WHERE crop_id IS ? AND language = ? AND question = ?', params: [...vals, cropId, language, question] },
        { sql: 'INSERT INTO qa_items (crop_id, language, question, answer, keywords, reviewer, approved_at, status, is_placeholder) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM qa_items WHERE crop_id IS ? AND language = ? AND question = ?)', params: [cropId, language, question, ...vals, cropId, language, question] },
      ];
    },
  },
  'alert-rules': {
    columns: ['key', 'metric', 'operator', 'threshold', 'window_days', 'severity', 'enabled', 'needs_review'],
    exportSql: 'SELECT key, metric, operator, threshold, window_days, severity, enabled, needs_review FROM alert_rules ORDER BY key',
    build(r) {
      const needsReview = flag(r, 'needs_review', 1);
      // Clearing needs_review needs a named reviewer (optional column, not exported).
      if (needsReview === 0 && !opt(r, 'reviewer', 80)) throw new RowError('needs_review = 0 requires a reviewer column with a name');
      const key = req(r, 'key', 40);
      if (!/^[a-z_]{2,40}$/.test(key)) throw new RowError('key must be lowercase letters and underscores');
      const vals = [oneOf(r, 'metric', ['precip_day_mm', 'dry_days_consecutive', 'tmax_c'] as const), oneOf(r, 'operator', ['>=', '>', '<=', '<'] as const, '>='), numOf(r, 'threshold', -1000, 10000), numOf(r, 'window_days', 1, 7), oneOf(r, 'severity', ['watch', 'warning'] as const, 'watch'), flag(r, 'enabled', 1), needsReview];
      return [{ sql: 'INSERT INTO alert_rules (key, metric, operator, threshold, window_days, severity, enabled, needs_review) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET metric = excluded.metric, operator = excluded.operator, threshold = excluded.threshold, window_days = excluded.window_days, severity = excluded.severity, enabled = excluded.enabled, needs_review = excluded.needs_review', params: [key, ...vals] }];
    },
  },
  'alert-advice': {
    columns: ['rule_key', 'crop_slug', 'language', 'text', 'reviewer', 'approved_at', 'status', 'is_placeholder'],
    exportSql: `SELECT a.rule_key, c.slug AS crop_slug, a.language, a.text, a.reviewer, a.approved_at, a.status, a.is_placeholder FROM alert_advice a LEFT JOIN crops c ON c.id = a.crop_id ORDER BY a.id`,
    build(r, ctx) {
      const ruleKey = req(r, 'rule_key', 40);
      if (!ctx.rules.has(ruleKey)) throw new RowError(`unknown rule_key "${ruleKey}"`);
      const cropId = cropOf(r, ctx, false);
      const language = langOf(r);
      const a = approval(r, ctx);
      const vals = [req(r, 'text', 1000), a.reviewer, a.approvedAt, a.status, a.isPlaceholder];
      return [
        { sql: 'UPDATE alert_advice SET text = ?, reviewer = ?, approved_at = ?, status = ?, is_placeholder = ? WHERE rule_key = ? AND crop_id IS ? AND language = ?', params: [...vals, ruleKey, cropId, language] },
        { sql: 'INSERT INTO alert_advice (rule_key, crop_id, language, text, reviewer, approved_at, status, is_placeholder) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM alert_advice WHERE rule_key = ? AND crop_id IS ? AND language = ?)', params: [ruleKey, cropId, language, ...vals, ruleKey, cropId, language] },
      ];
    },
  },
};

function isType(t: string): t is ImportType {
  return (IMPORT_TYPES as readonly string[]).includes(t);
}

/** Row-level validation and statement building, shared by import and tests. */
export async function planImport(db: D1Database, type: ImportType, text: string, now: string) {
  const rows = parseCsv(text);
  if (rows.length > MAX_ROWS) throw new ApiError(400, 'too_many_rows', `At most ${MAX_ROWS} rows per import`);
  const imp = IMPORTERS[type];
  const header = text.split(/\r?\n/, 1)[0]?.split(',').map((h) => h.trim().replace(/^"|"$/g, '')) ?? [];
  const missing = imp.columns.filter((c) => !header.includes(c) && !(type === 'alert-rules' && c === 'reviewer'));
  const required = new Set(imp.columns);
  if (type === 'crops') ['name_pcm', 'name_ha', 'name_yo', 'name_ig'].forEach((c) => required.delete(c));
  const missingRequired = missing.filter((c) => required.has(c) && !['name_pcm', 'name_ha', 'name_yo', 'name_ig'].includes(c));
  if (missingRequired.length) throw new ApiError(400, 'bad_header', `Missing column(s): ${missingRequired.join(', ')}`);
  const crops = new Map((await db.prepare('SELECT id, slug FROM crops').all<{ id: number; slug: string }>()).results.map((c) => [c.slug, c.id]));
  const rules = new Set((await db.prepare('SELECT key FROM alert_rules').all<{ key: string }>()).results.map((r) => r.key));
  const ctx: Ctx = { crops, rules, now };
  const errors: { row: number; message: string }[] = [];
  const valid: { row: number; stmts: Stmt[] }[] = [];
  rows.forEach((r, i) => {
    try {
      valid.push({ row: i + 2, stmts: imp.build(r, ctx) });
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      errors.push({ row: i + 2, message: e.message });
    }
  });
  return { total: rows.length, valid, errors };
}

csvRoutes.post('/import/:type', async (c) => {
  const type = c.req.param('type');
  if (!isType(type)) throw new ApiError(404, 'not_found', 'Unknown import type');
  const mode = c.req.query('mode') ?? 'all-or-nothing';
  if (mode !== 'all-or-nothing' && mode !== 'skip-invalid') throw new ApiError(400, 'validation_error', 'mode must be all-or-nothing or skip-invalid');
  const text = await c.req.text();
  if (text.length > MAX_BYTES) throw new ApiError(400, 'too_large', 'CSV is larger than 1 MB');
  if (!text.trim()) throw new ApiError(400, 'validation_error', 'Empty CSV');
  const now = c.get('deps').now().toISOString();
  const plan = await planImport(c.env.DB, type, text, now);
  if (mode === 'all-or-nothing' && plan.errors.length > 0)
    return c.json({ imported: 0, skipped: plan.total, applied: false, errors: plan.errors.slice(0, 200), error: { code: 'import_rejected', message: `${plan.errors.length} row(s) invalid; nothing was imported.` } }, 422);
  const stmts = plan.valid.flatMap((v) => v.stmts).map((s) => c.env.DB.prepare(s.sql).bind(...s.params));
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  await audit(c, 'import', type, { mode, imported: plan.valid.length, skipped: plan.errors.length });
  return c.json({ imported: plan.valid.length, skipped: plan.errors.length, applied: true, errors: plan.errors.slice(0, 200) });
});

function safeCell(v: unknown): unknown {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

csvRoutes.get('/export/:type', async (c) => {
  const type = c.req.param('type');
  if (!isType(type)) throw new ApiError(404, 'not_found', 'Unknown export type');
  const imp = IMPORTERS[type];
  const { results } = await c.env.DB.prepare(imp.exportSql).all<Record<string, unknown>>();
  const rows = results.map((r) => {
    if (type === 'crops') {
      let names: Record<string, string> = {};
      try { names = JSON.parse(String(r.names_json ?? '{}')); } catch { /* keep empty */ }
      return { slug: r.slug, name_en: r.name_en, name_pcm: names.pcm, name_ha: names.ha, name_yo: names.yo, name_ig: names.ig };
    }
    return r;
  });
  const out = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)])));
  return c.body(toCsv(imp.columns, out), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="agrivoice-${type}.csv"` });
});
