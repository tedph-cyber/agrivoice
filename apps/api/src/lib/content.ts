import { alertMessage, evaluateRules, scoreQa, t, type ActiveAlert, type AlertRule } from '@agrivoice/core';
import { APPROVED_SQL, camelRow } from './util';

export interface CropRow {
  id: number;
  slug: string;
  name_en: string;
  names_json: string;
}

export function cropName(c: CropRow, lang: string): string {
  try {
    const names = JSON.parse(c.names_json) as Record<string, string>;
    return names[lang] || c.name_en;
  } catch {
    return c.name_en;
  }
}

export async function listCrops(db: D1Database, lang: string): Promise<{ id: number; slug: string; name: string }[]> {
  const { results } = await db.prepare('SELECT id, slug, name_en, names_json FROM crops ORDER BY name_en').all<CropRow>();
  return results.map((c) => ({ id: c.id, slug: c.slug, name: cropName(c, lang) }));
}

/** Crops that have at least one approved brief, Q&A item or approved price (used by USSD). */
export async function listCropsWithContent(db: D1Database, lang: string): Promise<{ id: number; name: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name_en, c.names_json FROM crops c WHERE
        EXISTS (SELECT 1 FROM briefs b WHERE b.crop_id = c.id AND ${APPROVED_SQL('b')})
        OR EXISTS (SELECT 1 FROM qa_items q WHERE q.crop_id = c.id AND ${APPROVED_SQL('q')})
        OR EXISTS (SELECT 1 FROM price_reports p WHERE p.crop_id = c.id AND p.status = 'approved')
       ORDER BY c.name_en`,
    )
    .all<CropRow>();
  return results.map((c) => ({ id: c.id, name: cropName(c, lang) }));
}

export interface BriefRow {
  id: number;
  state: string;
  crop_id: number;
  language: string;
  week_start: string;
  title: string;
  body: string;
  ussd_summary: string | null;
  audio_url: string | null;
  reviewer: string;
  approved_at: string;
  is_placeholder: number;
}

export async function latestBrief(db: D1Database, state: string, cropId: number, lang: string): Promise<BriefRow | null> {
  for (const l of lang === 'en' ? ['en'] : [lang, 'en']) {
    const row = await db
      .prepare(
        `SELECT b.* FROM briefs b WHERE b.state = ? AND b.crop_id = ? AND b.language = ? AND ${APPROVED_SQL('b')}
         ORDER BY b.week_start DESC, b.id DESC LIMIT 1`,
      )
      .bind(state, cropId, l)
      .first<BriefRow>();
    if (row) return row;
  }
  return null;
}

export interface PriceRow {
  id: number;
  market_id: number;
  market: string;
  state: string;
  crop_id: number;
  unit: string;
  price_ngn: number;
  reported_at: string;
  is_placeholder: number;
}

export async function latestPrices(
  db: D1Database,
  now: Date,
  f: { cropId?: number; state?: string; marketId?: number },
): Promise<(Record<string, unknown> & { ageDays: number })[]> {
  const where: string[] = ["p.status = 'approved'"];
  const params: unknown[] = [];
  if (f.cropId) {
    where.push('p.crop_id = ?');
    params.push(f.cropId);
  }
  if (f.state) {
    where.push('m.state = ?');
    params.push(f.state);
  }
  if (f.marketId) {
    where.push('p.market_id = ?');
    params.push(f.marketId);
  }
  const { results } = await db
    .prepare(
      `SELECT p.id, p.market_id, m.name AS market, m.state, p.crop_id, c.name_en AS crop, p.unit, p.price_ngn, p.reported_at, p.is_placeholder
       FROM price_reports p JOIN markets m ON m.id = p.market_id JOIN crops c ON c.id = p.crop_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.reported_at DESC, p.id DESC`,
    )
    .bind(...params)
    .all<PriceRow & { crop: string }>();
  const seen = new Set<string>();
  const out: (Record<string, unknown> & { ageDays: number })[] = [];
  for (const r of results) {
    const key = `${r.market_id}|${r.crop_id}|${r.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...camelRow(r as unknown as Record<string, unknown>),
      isPlaceholder: !!r.is_placeholder,
      ageDays: Math.max(0, Math.floor((now.getTime() - new Date(r.reported_at).getTime()) / 86400_000)),
    });
  }
  return out;
}

export interface QaRow {
  id: number;
  crop_id: number | null;
  language: string;
  question: string;
  answer: string;
  keywords: string;
  is_placeholder: number;
}

export async function approvedQa(db: D1Database, lang: string, cropId?: number): Promise<QaRow[]> {
  const langs = lang === 'en' ? ['en'] : [lang, 'en'];
  const params: unknown[] = [...langs];
  let cropSql = '';
  if (cropId) {
    cropSql = ' AND (q.crop_id = ? OR q.crop_id IS NULL)';
    params.push(cropId);
  }
  const { results } = await db
    .prepare(
      `SELECT q.id, q.crop_id, q.language, q.question, q.answer, q.keywords, q.is_placeholder FROM qa_items q
       WHERE q.language IN (${langs.map(() => '?').join(',')}) AND ${APPROVED_SQL('q')}${cropSql}
       ORDER BY (q.crop_id IS NULL), q.id`,
    )
    .bind(...params)
    .all<QaRow>();
  // prefer requested language over English duplicates only by ordering: keep all, requested language first
  return results.sort((a, b) => (a.language === lang ? 0 : 1) - (b.language === lang ? 0 : 1));
}

export async function searchQa(db: D1Database, q: string, lang: string, cropId?: number) {
  const items = await approvedQa(db, lang, cropId);
  return items
    .map((i) => ({ item: i, score: Math.round(scoreQa(q, i) * 1000) / 1000 }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id - b.item.id)
    .slice(0, 3)
    .map(({ item, score }) => ({
      id: item.id,
      question: item.question,
      answer: item.answer,
      cropId: item.crop_id,
      language: item.language,
      score,
      isPlaceholder: !!item.is_placeholder,
    }));
}

interface RuleRow {
  key: string;
  metric: string;
  operator: string;
  threshold: number;
  window_days: number;
  severity: 'watch' | 'warning';
  enabled: number;
  needs_review: number;
}

export async function loadRules(db: D1Database): Promise<AlertRule[]> {
  const { results } = await db.prepare('SELECT * FROM alert_rules').all<RuleRow>();
  return results.map((r) => ({
    key: r.key,
    metric: r.metric,
    operator: r.operator,
    threshold: r.threshold,
    windowDays: r.window_days,
    severity: r.severity,
    enabled: !!r.enabled,
    needsReview: !!r.needs_review,
  }));
}

export interface AlertView {
  ruleKey: string;
  severity: 'watch' | 'warning';
  date: string;
  message: string;
  advice: string | null;
  needsReview: boolean;
  unconfirmedLabel: string | null;
  isPlaceholder: boolean;
}

export async function alertAdvice(db: D1Database, ruleKey: string, cropId: number | undefined, lang: string) {
  const langs = lang === 'en' ? ['en'] : [lang, 'en'];
  for (const l of langs) {
    const row = await db
      .prepare(
        `SELECT a.text, a.is_placeholder FROM alert_advice a
         WHERE a.rule_key = ? AND a.language = ? AND (a.crop_id = ? OR a.crop_id IS NULL) AND ${APPROVED_SQL('a')}
         ORDER BY (a.crop_id IS NULL), a.id LIMIT 1`,
      )
      .bind(ruleKey, l, cropId ?? -1)
      .first<{ text: string; is_placeholder: number }>();
    if (row) return row;
  }
  return null;
}

export async function buildAlerts(
  db: D1Database,
  days: Parameters<typeof evaluateRules>[0],
  place: string,
  cropId: number | undefined,
  lang: string,
): Promise<AlertView[]> {
  const active: ActiveAlert[] = evaluateRules(days, await loadRules(db));
  const out: AlertView[] = [];
  for (const a of active) {
    const adv = await alertAdvice(db, a.ruleKey, cropId, lang);
    out.push({
      ruleKey: a.ruleKey,
      severity: a.severity,
      date: a.date,
      message: alertMessage(a, place, lang),
      advice: adv?.text ?? null,
      needsReview: a.needsReview,
      unconfirmedLabel: a.needsReview ? t(lang, 'alert.unconfirmed') : null,
      isPlaceholder: !!adv?.is_placeholder,
    });
  }
  return out;
}

export function placeName(loc: { state: string; lga: string | null }): string {
  return loc.lga ?? loc.state;
}
