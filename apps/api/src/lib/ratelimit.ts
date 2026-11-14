import type { Context } from 'hono';
import { sha256Hex } from '@agrivoice/core';
import type { AppEnv } from '../env';
import { ApiError, clientIp } from './util';

/** Fixed-window counter in D1. Returns the new count for this window. */
export async function hit(db: D1Database, key: string, windowSec: number, now: Date): Promise<number> {
  const start = new Date(Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000).toISOString();
  const k = `${key}|${windowSec}`;
  await db
    .prepare(
      'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1',
    )
    .bind(k, start)
    .run();
  const row = await db.prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?').bind(k, start).first<{ count: number }>();
  return row?.count ?? 1;
}

export async function peek(db: D1Database, key: string, windowSec: number, now: Date): Promise<number> {
  const start = new Date(Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000).toISOString();
  const row = await db
    .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
    .bind(`${key}|${windowSec}`, start)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function ipKey(c: Context<AppEnv>, scope: string): Promise<string> {
  const salt = c.env.PHONE_HASH_SECRET ?? '';
  return `${scope}:ip:${(await sha256Hex(clientIp(c) + salt)).slice(0, 24)}`;
}

/** Throws 429 if the caller exceeds `limit` hits in the window. */
export async function limit(c: Context<AppEnv>, scope: string, max: number, windowSec: number, extraKey?: string): Promise<void> {
  const now = c.get('deps').now();
  const keys = [await ipKey(c, scope)];
  if (extraKey) keys.push(`${scope}:k:${extraKey}`);
  for (const k of keys) {
    const n = await hit(c.env.DB, k, windowSec, now);
    if (n > max) throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait and try again.');
  }
}
