import { Hono } from 'hono';
import { z } from 'zod';
import { constantTimeEqual, lastInput, maskPhone, SESSION_TTL_MS, step, type SessionState } from '@agrivoice/core';
import type { AppEnv, Deps, Env } from '../env';
import { ApiError, languages, parseBody } from '../lib/util';
import { limit } from '../lib/ratelimit';
import { loadProfile, makeUssdCtx } from '../lib/ussd-ctx';
import { hit } from '../lib/ratelimit';
import { parseAtForm, formatAtReply } from '../adapters/ussd-at';

export const ussdRoutes = new Hono<AppEnv>();

export async function handleUssd(
  env: Env,
  deps: Deps,
  input: { sessionId: string; phone: string; text: string; channel: 'ussd' | 'sim'; languages: string[] },
): Promise<{ text: string; end: boolean }> {
  const { profile, hash } = await loadProfile(env, input.phone);
  // Per-phone ceiling (hashed key) so a leaked callback token cannot be used to hammer one subscriber.
  if ((await hit(env.DB, `ussd:ph:${hash.slice(0, 24)}`, 3600, deps.now())) > 300)
    return { text: 'END Too many requests. Please try again later.', end: true };
  const nowMs = deps.now().getTime();
  const row = await env.DB.prepare('SELECT state_json, updated_at FROM ussd_sessions WHERE session_id = ?')
    .bind(input.sessionId)
    .first<{ state_json: string; updated_at: string }>();
  let state: SessionState | null = null;
  let newSession = true;
  if (row && nowMs - new Date(row.updated_at).getTime() <= SESSION_TTL_MS) {
    try {
      state = JSON.parse(row.state_json) as SessionState;
      newSession = false;
    } catch {
      state = null;
    }
  }
  const ctx = makeUssdCtx(env, deps, { phone: input.phone, phoneHash: hash, channel: input.channel, languages: input.languages });
  const r = await step(newSession ? null : state, newSession ? '' : lastInput(input.text), ctx, profile);
  if (r.end) {
    await env.DB.prepare('DELETE FROM ussd_sessions WHERE session_id = ?').bind(input.sessionId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO ussd_sessions (session_id, phone_hash, state_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at, phone_hash = excluded.phone_hash`,
    )
      .bind(input.sessionId, hash, JSON.stringify(r.state), deps.now().toISOString())
      .run();
  }
  void maskPhone; // phone numbers are never logged
  return { text: r.text, end: r.end };
}

ussdRoutes.post('/ussd/at/:token', async (c) => {
  const expected = c.env.USSD_PATH_TOKEN ?? '';
  if (!expected || !constantTimeEqual(c.req.param('token'), expected)) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  let form: Record<string, string>;
  try {
    form = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
  } catch {
    throw new ApiError(400, 'validation_error', 'Expected form data');
  }
  const req = parseAtForm(form);
  const out = await handleUssd(c.env, c.get('deps'), { ...req, channel: 'ussd', languages: languages(c) });
  return c.text(formatAtReply(out), 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

ussdRoutes.post('/ussd/sim', async (c) => {
  await limit(c, 'ussd-sim', 240, 600);
  const b = await parseBody(
    c,
    z.object({
      sessionId: z.string().min(4).max(64).regex(/^[\w-]+$/),
      phone: z.string().regex(/^\+?\d{7,15}$/),
      text: z.string().max(200).default(''),
    }),
  );
  const out = await handleUssd(c.env, c.get('deps'), {
    sessionId: 'sim-' + b.sessionId,
    phone: b.phone,
    text: b.text,
    channel: 'sim',
    languages: languages(c),
  });
  return c.json(out);
});
