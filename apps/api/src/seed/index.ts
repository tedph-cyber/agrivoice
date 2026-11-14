import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '@agrivoice/core';

export type Stmt = { sql: string; params: (string | number | null)[] };

export const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

export async function migrate(db: D1Database): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(((await db.prepare('SELECT name FROM _migrations').all<{ name: string }>()).results).map((r) => r.name));
  const ran: string[] = [];
  for (const f of readdirSync(join(ROOT, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    if (applied.has(f)) continue;
    await db.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8'));
    await db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').bind(f, new Date().toISOString()).run();
    ran.push(f);
  }
  return ran;
}

export function readTemplate(name: string): Record<string, string>[] {
  return parseCsv(readFileSync(join(ROOT, 'content-templates', name), 'utf8'));
}

const num = (v: string | undefined): number | null => (v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function stateCapitals(): [string, string, number, number][] {
  return JSON.parse(readFileSync(join(ROOT, 'scripts', 'data', 'state-capitals.json'), 'utf8'));
}

/** Base data only: states, crops, default alert rules. Idempotent. */
export function baseSeedStatements(): Stmt[] {
  const out: Stmt[] = [];
  for (const [state, , lat, lon] of stateCapitals())
    out.push({
      sql: "INSERT INTO locations (state, lga, lat, lon, source) SELECT ?, NULL, ?, ?, 'state-capital-fallback' WHERE NOT EXISTS (SELECT 1 FROM locations WHERE state = ? AND lga IS NULL)",
      params: [state, lat, lon, state],
    });
  for (const c of readTemplate('crops.csv')) {
    const names: Record<string, string> = {};
    for (const l of ['pcm', 'ha', 'yo', 'ig']) if (c[`name_${l}`]) names[l] = c[`name_${l}`]!;
    out.push({
      sql: 'INSERT INTO crops (slug, name_en, names_json) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET name_en = excluded.name_en, names_json = excluded.names_json',
      params: [c.slug!, c.name_en!, JSON.stringify(names)],
    });
  }
  for (const r of readTemplate('alert_rules.csv'))
    out.push({
      sql: 'INSERT OR IGNORE INTO alert_rules (key, metric, operator, threshold, window_days, severity, enabled, needs_review) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      params: [r.key!, r.metric!, r.operator || '>=', Number(r.threshold), Number(r.window_days), r.severity || 'watch', num(r.enabled) ?? 1, num(r.needs_review) ?? 1],
    });
  return out;
}

export async function runStatements(db: D1Database, stmts: Stmt[]): Promise<void> {
  const prepared = stmts.map((s) => db.prepare(s.sql).bind(...s.params));
  for (let i = 0; i < prepared.length; i += 50) await db.batch(prepared.slice(i, i + 50));
}

export const seedBase = (db: D1Database) => runStatements(db, baseSeedStatements());

/** LGA points for a state: geocoded when `geocode` returns a point, else the state point. */
export async function lgaStatements(
  state: string,
  lgas: string[],
  statePoint: { lat: number; lon: number },
  geocode?: (name: string) => Promise<{ lat: number; lon: number } | null>,
): Promise<Stmt[]> {
  const out: Stmt[] = [];
  for (const lga of lgas) {
    let pt: { lat: number; lon: number } | null = null;
    try {
      pt = geocode ? await geocode(lga) : null;
    } catch {
      pt = null;
    }
    out.push({
      sql: "INSERT INTO locations (state, lga, lat, lon, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT(state, lga) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, source = excluded.source",
      params: [state, lga, (pt ?? statePoint).lat, (pt ?? statePoint).lon, pt ? 'open-meteo-geocoding' : 'state-point-fallback'],
    });
  }
  return out;
}

/** Geocode via Open-Meteo, accepting only Nigerian results whose admin1 matches the state. */
export async function geocodeLga(f: typeof fetch, state: string, name: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json&countryCode=NG`;
  const res = await f(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: { latitude: number; longitude: number; admin1?: string }[] };
  const hit = j.results?.find((r) => (r.admin1 ?? '').toLowerCase().startsWith(state.toLowerCase()));
  return hit ? { lat: hit.latitude, lon: hit.longitude } : null;
}

export function sqlLiteral(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

export function renderSql(stmts: Stmt[]): string {
  return stmts.map((s) => {
    let i = 0;
    return s.sql.replace(/\?/g, () => sqlLiteral(s.params[i++] ?? null)) + ';';
  }).join('\n') + '\n';
}

export { purge } from '../lib/purge';
