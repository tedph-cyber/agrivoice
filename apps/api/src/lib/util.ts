import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export async function parseBody<T extends z.ZodTypeAny>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be JSON');
  }
  return parse(schema, raw);
}

export function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
    throw new ApiError(400, 'validation_error', msg);
  }
  return r.data;
}

export function nowIso(c: Context<AppEnv>): string {
  return c.get('deps').now().toISOString();
}

export const APPROVED_SQL = (alias: string) =>
  `${alias}.status = 'approved' AND ${alias}.reviewer IS NOT NULL AND TRIM(${alias}.reviewer) <> '' AND ${alias}.approved_at IS NOT NULL`;

export function snake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}
export function camel(s: string): string {
  return s.replace(/_([a-z])/g, (_, m: string) => m.toUpperCase());
}
export function camelRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = k.startsWith('is_') || k === 'enabled' || k === 'needs_review' || k === 'active' ? !!v : v;
  return out;
}

export function languages(c: Context<AppEnv>): string[] {
  const l = (c.env.ENABLED_LANGUAGES ?? 'en').split(',').map((s) => s.trim()).filter(Boolean);
  return l.length ? l : ['en'];
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}
