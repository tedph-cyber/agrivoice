import { generateReporterCode, hashReporterCode } from '@agrivoice/core';
import { readTemplate, runStatements, type Stmt } from './index';

const nz = (v: string | undefined) => (v === undefined || v === '' ? null : v);

/**
 * Flagged demo content from content-templates/. Everything is is_placeholder = 1.
 * Idempotent: placeholder rows are replaced on re-run.
 */
export async function seedDemo(db: D1Database, opts: { pepper: string; now?: Date; lgaState?: string }): Promise<{ reporterCode: string | null }> {
  const now = (opts.now ?? new Date()).toISOString();
  const pre: Stmt[] = [
    { sql: 'DELETE FROM price_reports WHERE is_placeholder = 1', params: [] },
    { sql: 'DELETE FROM briefs WHERE is_placeholder = 1', params: [] },
    { sql: 'DELETE FROM qa_items WHERE is_placeholder = 1', params: [] },
    { sql: 'DELETE FROM alert_advice WHERE is_placeholder = 1', params: [] },
  ];
  await runStatements(db, pre);

  const cropId = async (slug: string) => (await db.prepare('SELECT id FROM crops WHERE slug = ?').bind(slug).first<{ id: number }>())?.id ?? null;
  const stmts: Stmt[] = [];

  for (const b of readTemplate('briefs.csv')) {
    const id = await cropId(b.crop_slug!);
    if (!id) continue;
    stmts.push({
      sql: 'INSERT INTO briefs (state, crop_id, language, week_start, title, body, ussd_summary, audio_url, reviewer, approved_at, status, is_placeholder) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)',
      params: [b.state!, id, b.language || 'en', b.week_start!, b.title!, b.body!, nz(b.ussd_summary), nz(b.audio_url), nz(b.reviewer), nz(b.approved_at), b.status || 'draft'],
    });
  }
  for (const q of readTemplate('qa.csv')) {
    const id = q.crop_slug ? await cropId(q.crop_slug) : null;
    if (q.crop_slug && !id) continue;
    stmts.push({
      sql: 'INSERT INTO qa_items (crop_id, language, question, answer, keywords, reviewer, approved_at, status, is_placeholder) VALUES (?,?,?,?,?,?,?,?,1)',
      params: [id, q.language || 'en', q.question!, q.answer!, q.keywords ?? '', nz(q.reviewer), nz(q.approved_at), q.status || 'draft'],
    });
  }
  for (const a of readTemplate('alert_advice.csv')) {
    const id = a.crop_slug ? await cropId(a.crop_slug) : null;
    if (a.crop_slug && !id) continue;
    stmts.push({
      sql: 'INSERT INTO alert_advice (rule_key, crop_id, language, text, reviewer, approved_at, status, is_placeholder) VALUES (?,?,?,?,?,?,?,1)',
      params: [a.rule_key!, id, a.language || 'en', a.text!, nz(a.reviewer), nz(a.approved_at), a.status || 'draft'],
    });
  }
  const marketRows = readTemplate('markets.csv');
  for (const m of marketRows)
    stmts.push({
      sql: 'INSERT INTO markets (name, state, lga, lat, lon, is_placeholder) SELECT ?,?,?,?,?,1 WHERE NOT EXISTS (SELECT 1 FROM markets WHERE name = ? AND state = ?)',
      params: [m.name!, m.state!, nz(m.lga), m.lat ? Number(m.lat) : null, m.lon ? Number(m.lon) : null, m.name!, m.state!],
    });
  await runStatements(db, stmts);

  // Demo prices: placeholder amounts, clearly flagged. Not real market data.
  const markets = (await db.prepare('SELECT id FROM markets WHERE is_placeholder = 1 ORDER BY id').all<{ id: number }>()).results;
  const crops = (await db.prepare('SELECT id FROM crops ORDER BY id').all<{ id: number }>()).results;
  const priceStmts: Stmt[] = [];
  let seq = 0;
  for (const m of markets)
    for (const c of crops) {
      seq++;
      priceStmts.push({
        sql: "INSERT INTO price_reports (market_id, crop_id, unit, price_ngn, reported_at, status, reviewed_at, is_placeholder) VALUES (?,?,?,?,?,'approved',?,1)",
        params: [m.id, c.id, 'bag', 1000 * seq, new Date(Date.parse(now) - seq * 86400_000).toISOString(), now],
      });
    }
  await runStatements(db, priceStmts);

  // LGA points for the demo state if none exist yet (fallback to state point, flagged by source).
  const lgaState = opts.lgaState ?? 'Ogun';
  void lgaState;

  let reporterCode: string | null = null;
  const mk = markets[0];
  const exists = await db.prepare("SELECT id FROM reporters WHERE display_name = 'DEMO reporter'").first();
  if (!exists) {
    reporterCode = generateReporterCode();
    await db
      .prepare('INSERT INTO reporters (code_hash, display_name, market_id, active, created_at) VALUES (?,?,?,1,?)')
      .bind(await hashReporterCode(reporterCode, opts.pepper), 'DEMO reporter', mk?.id ?? null, now)
      .run();
  }
  return { reporterCode };
}
