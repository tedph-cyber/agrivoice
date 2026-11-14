import { hashPhone, truncate, type Profile, type UssdCtx, type WeatherView } from '@agrivoice/core';
import type { Deps, Env } from '../env';
import { buildAlerts, latestBrief, latestPrices, listCropsWithContent, approvedQa, placeName } from './content';
import { getForecast, getLocation } from './forecast';

export async function loadProfile(env: Env, phone: string): Promise<{ profile: Profile | null; hash: string }> {
  const hash = await hashPhone(phone, env.PHONE_HASH_SECRET ?? '');
  const row = await env.DB.prepare(
    `SELECT f.language, f.location_id, f.crop_ids_json, l.state, l.lga FROM farmers f JOIN locations l ON l.id = f.location_id WHERE f.phone_hash = ?`,
  )
    .bind(hash)
    .first<{ language: string; location_id: number; crop_ids_json: string; state: string; lga: string | null }>();
  if (!row) return { profile: null, hash };
  const cropId = (JSON.parse(row.crop_ids_json) as number[])[0];
  if (!cropId) return { profile: null, hash };
  const crop = await env.DB.prepare('SELECT name_en, names_json FROM crops WHERE id = ?').bind(cropId).first<{ name_en: string; names_json: string }>();
  if (!crop) return { profile: null, hash };
  let name = crop.name_en;
  try {
    name = (JSON.parse(crop.names_json) as Record<string, string>)[row.language] || crop.name_en;
  } catch {
    /* keep english */
  }
  return {
    hash,
    profile: { lang: row.language, stateName: row.state, lgaName: row.lga, locationId: row.location_id, cropId, cropName: name },
  };
}

export function makeUssdCtx(env: Env, deps: Deps, opts: { phone: string; phoneHash: string; channel: 'ussd' | 'sim'; languages: string[] }): UssdCtx {
  const db = env.DB;
  const now = () => deps.now().toISOString();
  return {
    languages: opts.languages,
    listStates: async () =>
      (await db.prepare('SELECT state FROM locations WHERE lga IS NULL ORDER BY state').all<{ state: string }>()).results.map((r) => r.state),
    listLgas: async (state) =>
      (await db.prepare('SELECT id, lga FROM locations WHERE state = ? AND lga IS NOT NULL ORDER BY lga').bind(state).all<{ id: number; lga: string }>()).results.map(
        (r) => ({ locationId: r.id, name: r.lga }),
      ),
    stateLocationId: async (state) =>
      (await db.prepare('SELECT id FROM locations WHERE state = ? AND lga IS NULL').bind(state).first<{ id: number }>())?.id ?? null,
    listCrops: (lang) => listCropsWithContent(db, lang),
    getBrief: async (state, cropId, lang) => {
      const b = await latestBrief(db, state, cropId, lang);
      if (!b) return null;
      return { summary: b.ussd_summary?.trim() || truncate(b.body, 140), isPlaceholder: !!b.is_placeholder };
    },
    getWeather: async (locationId, cropId, lang): Promise<WeatherView | null> => {
      const loc = await getLocation(db, locationId);
      if (!loc) return null;
      try {
        const f = await getForecast(env, deps, loc);
        const alerts = await buildAlerts(db, f.days, placeName(loc), cropId, lang);
        const top = alerts[0];
        const ageMs = deps.now().getTime() - new Date(f.fetchedAt).getTime();
        return {
          alertMessage: top ? top.message : null,
          unconfirmed: !!top?.needsReview,
          days: f.days.map((d) => ({ date: d.date, precipMm: d.precipMm, tminC: d.tminC, tmaxC: d.tmaxC })),
          fetchedAt: f.fetchedAt,
          stale: f.stale || ageMs > 6 * 3600_000,
        };
      } catch {
        return null;
      }
    },
    listPrices: async (cropId, state) =>
      (await latestPrices(db, deps.now(), { cropId, state })).map((p) => ({
        market: String(p.market),
        priceNgn: Number(p.priceNgn),
        unit: String(p.unit),
        ageDays: p.ageDays,
        isPlaceholder: !!p.isPlaceholder,
      })),
    listQa: async (cropId, lang) =>
      (await approvedQa(db, lang, cropId)).map((q) => ({ id: q.id, question: q.question, answer: q.answer, isPlaceholder: !!q.is_placeholder })),
    saveProfile: async (p) => {
      const ts = now();
      await db
        .prepare(
          `INSERT INTO farmers (phone_hash, language, location_id, crop_ids_json, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(phone_hash) DO UPDATE SET language = excluded.language, location_id = excluded.location_id, crop_ids_json = excluded.crop_ids_json`,
        )
        .bind(opts.phoneHash, p.lang, p.locationId, JSON.stringify([p.cropId]), ts)
        .run();
      const f = await db.prepare('SELECT id FROM farmers WHERE phone_hash = ?').bind(opts.phoneHash).first<{ id: number }>();
      if (f) {
        const has = await db
          .prepare("SELECT id FROM consents WHERE farmer_id = ? AND purpose = 'profile' AND withdrawn_at IS NULL")
          .bind(f.id)
          .first();
        if (!has) await db.prepare("INSERT INTO consents (farmer_id, purpose, given_at) VALUES (?, 'profile', ?)").bind(f.id, ts).run();
      }
    },
    deleteProfile: async () => {
      const f = await db.prepare('SELECT id FROM farmers WHERE phone_hash = ?').bind(opts.phoneHash).first<{ id: number }>();
      if (!f) return false;
      await db.prepare('DELETE FROM consents WHERE farmer_id = ?').bind(f.id).run();
      await db.prepare('DELETE FROM farmers WHERE id = ?').bind(f.id).run();
      return true;
    },
    saveCallback: async ({ topic, consent, lang, locationId }) => {
      await db
        .prepare("INSERT INTO questions (channel, language, text, location_id, contact, status, created_at) VALUES ('ussd', ?, ?, ?, ?, 'open', ?)")
        .bind(lang, topic, locationId, consent ? opts.phone : null, now())
        .run();
    },
    recordEvent: async (kind, state) => {
      await db.prepare('INSERT INTO events (at, channel, kind, state) VALUES (?, ?, ?, ?)').bind(now(), opts.channel, kind, state).run();
    },
  };
}
