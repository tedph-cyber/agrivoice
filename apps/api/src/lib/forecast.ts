import type { DayForecast } from '@agrivoice/core';
import type { Deps, Env } from '../env';
import { demoFixture, fetchForecast } from '../adapters/weather-openmeteo';
import { ApiError } from './util';

export interface LocationRow {
  id: number;
  state: string;
  lga: string | null;
  lat: number;
  lon: number;
}

export interface ForecastResult {
  location: { id: number; state: string; lga: string | null };
  fetchedAt: string;
  source: 'open-meteo' | 'demo-fixture';
  stale: boolean;
  isPlaceholder: boolean;
  days: DayForecast[];
}

export async function getLocation(db: D1Database, id: number): Promise<LocationRow | null> {
  return db.prepare('SELECT id, state, lga, lat, lon FROM locations WHERE id = ?').bind(id).first<LocationRow>();
}

export async function getForecast(env: Env, deps: Deps, loc: LocationRow): Promise<ForecastResult> {
  const ttlMs = Number(env.FORECAST_TTL_HOURS ?? 3) * 3600_000;
  const now = deps.now();
  const base = { location: { id: loc.id, state: loc.state, lga: loc.lga } };
  const cached = await env.DB.prepare('SELECT fetched_at, payload_json FROM forecast_cache WHERE location_id = ?')
    .bind(loc.id)
    .first<{ fetched_at: string; payload_json: string }>();
  const fromCache = (stale: boolean): ForecastResult => ({
    ...base,
    fetchedAt: cached!.fetched_at,
    source: 'open-meteo',
    stale,
    isPlaceholder: false,
    days: JSON.parse(cached!.payload_json) as DayForecast[],
  });
  if (cached && now.getTime() - new Date(cached.fetched_at).getTime() < ttlMs) return fromCache(false);
  try {
    const days = await fetchForecast(deps.fetch, loc.lat, loc.lon);
    const fetchedAt = now.toISOString();
    await env.DB.prepare(
      'INSERT INTO forecast_cache (location_id, fetched_at, payload_json) VALUES (?, ?, ?) ON CONFLICT(location_id) DO UPDATE SET fetched_at = excluded.fetched_at, payload_json = excluded.payload_json',
    )
      .bind(loc.id, fetchedAt, JSON.stringify(days))
      .run();
    return { ...base, fetchedAt, source: 'open-meteo', stale: false, isPlaceholder: false, days };
  } catch {
    if (cached) return fromCache(true);
    if (env.DEMO_MODE === '1')
      return { ...base, fetchedAt: now.toISOString(), source: 'demo-fixture', stale: false, isPlaceholder: true, days: demoFixture(now) };
    throw new ApiError(503, 'forecast_unavailable', 'Weather data is not available right now.');
  }
}
