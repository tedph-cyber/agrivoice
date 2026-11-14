import type { DayForecast } from '@agrivoice/core';

/**
 * Open-Meteo forecast adapter. Daily variables per Open-Meteo docs:
 * precipitation_sum, temperature_2m_max, temperature_2m_min, precipitation_probability_max.
 * (Not verifiable from the build sandbox; see DECISIONS.md.)
 */
export function forecastUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'Africa/Lagos',
    forecast_days: '7',
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

interface OpenMeteoDaily {
  time?: string[];
  precipitation_sum?: (number | null)[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  precipitation_probability_max?: (number | null)[];
}

export function parseForecast(json: unknown): DayForecast[] {
  const d = (json as { daily?: OpenMeteoDaily } | null)?.daily;
  if (!d || !Array.isArray(d.time) || d.time.length === 0) throw new Error('bad forecast payload');
  return d.time.map((date, i) => ({
    date,
    precipMm: d.precipitation_sum?.[i] ?? null,
    tmaxC: d.temperature_2m_max?.[i] ?? null,
    tminC: d.temperature_2m_min?.[i] ?? null,
    popPct: d.precipitation_probability_max?.[i] ?? null,
  }));
}

export async function fetchForecast(f: typeof fetch, lat: number, lon: number): Promise<DayForecast[]> {
  const res = await f(forecastUrl(lat, lon), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  return parseForecast(await res.json());
}

/** Deterministic offline fixture (DEMO_MODE only). Includes a heavy-rain day so alerts can be demonstrated. */
export function demoFixture(now: Date): DayForecast[] {
  const lagos = new Date(now.getTime() + 3600_000);
  const precip = [0.4, 3.2, 62.5, 18.0, 0, 0, 7.1];
  const tmax = [31.2, 30.4, 27.9, 28.8, 32.5, 33.1, 31.0];
  return precip.map((p, i) => {
    const d = new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + i));
    return {
      date: d.toISOString().slice(0, 10),
      precipMm: p,
      tmaxC: tmax[i]!,
      tminC: 21.5,
      popPct: p > 5 ? 80 : 20,
    };
  });
}
