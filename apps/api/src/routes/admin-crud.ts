import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiError, camelRow, nowIso, parse, parseBody, snake } from '../lib/util';
import { audit } from './admin';

type Row = Record<string, unknown>;

export interface Resource {
  path: string;
  table: string;
  /** camelCase API field names stored as snake_case columns of the same name */
  fields: string[];
  schema: z.ZodType<Row>;
  /** content-style resources: approved needs a reviewer, approved_at filled automatically */
  approval?: boolean;
  noCreate?: boolean;
  toDb?: (row: Row) => Row;
  fromDb?: (row: Row) => Row;
}

const bool = z.boolean().default(false);
const nstr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' || v === undefined ? null : v));
const status = z.enum(['draft', 'approved', 'archived']).default('draft');
const lang = z.string().regex(/^[a-z]{2,3}$/).default('en');

const contentCommon = {
  reviewer: nstr(80),
  approvedAt: nstr(40),
  status,
  isPlaceholder: bool,
};

const briefSchema = z.object({
  state: z.string().trim().min(2).max(40),
  cropId: z.number().int().positive(),
  language: lang,
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  ussdSummary: nstr(140),
  audioUrl: nstr(500).refine((v) => v === null || v === undefined || /^(\/audio\/[\w.-]+|https:\/\/\S+)$/.test(v), 'audioUrl must be /audio/<file> or https URL'),
  ...contentCommon,
});

const qaSchema = z.object({
  cropId: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
  language: lang,
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(3000),
  keywords: z.string().trim().max(300).default(''),
  ...contentCommon,
});

const adviceSchema = z.object({
  ruleKey: z.string().trim().min(1).max(40),
  cropId: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
  language: lang,
  text: z.string().trim().min(1).max(1000),
  ...contentCommon,
});

const ruleSchema = z.object({
  key: z.string().regex(/^[a-z_]{2,40}$/),
  metric: z.enum(['precip_day_mm', 'dry_days_consecutive', 'tmax_c']),
  operator: z.enum(['>=', '>', '<=', '<']).default('>='),
  threshold: z.number().finite(),
  windowDays: z.number().int().min(1).max(7),
  severity: z.enum(['watch', 'warning']).default('watch'),
  enabled: z.boolean().default(true),
  needsReview: z.boolean().default(true),
});

const marketSchema = z.object({
  name: z.string().trim().min(1).max(100),
  state: z.string().trim().min(2).max(40),
  lga: nstr(60),
  lat: z.number().min(-90).max(90).nullable().optional().transform((v) => v ?? null),
  lon: z.number().min(-180).max(180).nullable().optional().transform((v) => v ?? null),
  isPlaceholder: bool,
});

const cropSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  nameEn: z.string().trim().min(1).max(60),
  names: z.record(z.string().regex(/^[a-z]{2,3}$/), z.string().max(60)).default({}),
});

const reporterSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  marketId: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
  active: z.boolean().default(true),
});

export const RESOURCES: Resource[] = [
  { path: 'briefs', table: 'briefs', approval: true, schema: briefSchema, fields: ['state', 'cropId', 'language', 'weekStart', 'title', 'body', 'ussdSummary', 'audioUrl', 'reviewer', 'approvedAt', 'status', 'isPlaceholder'] },
  { path: 'qa', table: 'qa_items', approval: true, schema: qaSchema, fields: ['cropId', 'language', 'question', 'answer', 'keywords', 'reviewer', 'approvedAt', 'status', 'isPlaceholder'] },
  { path: 'alert-advice', table: 'alert_advice', approval: true, schema: adviceSchema, fields: ['ruleKey', 'cropId', 'language', 'text', 'reviewer', 'approvedAt', 'status', 'isPlaceholder'] },
  { path: 'alert-rules', table: 'alert_rules', schema: ruleSchema, fields: ['key', 'metric', 'operator', 'threshold', 'windowDays', 'severity', 'enabled', 'needsReview'] },
  { path: 'markets', table: 'markets', schema: marketSchema, fields: ['name', 'state', 'lga', 'lat', 'lon', 'isPlaceholder'] },
  {
    path: 'crops',
    table: 'crops',
    schema: cropSchema,
    fields: ['slug', 'nameEn', 'namesJson'],
    toDb: (r) => ({ slug: r.slug, nameEn: r.nameEn, namesJson: JSON.stringify(r.names ?? {}) }),
    fromDb: (r) => {
      const { namesJson, ...rest } = r;
      let names = {};
      try {
        names = JSON.parse(String(namesJson ?? '{}'));
      } catch {
        /* ignore */
      }
      return { ...rest, names };
    },
  },
  { path: 'reporters', table: 'reporters', noCreate: true, schema: reporterSchema, fields: ['displayName', 'marketId', 'active'] },
];

const idSchema = z.coerce.number().int().positive();

function isFkError(e: unknown): boolean {
  return /FOREIGN KEY|constraint/i.test(String((e as Error)?.message ?? e));
}

export function crudRoutes(resources: Resource[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  for (const res of resources) {
    const cols = res.fields.map(snake);
    const out = (row: Row) => {
      const r = camelRow(row);
      delete r.codeHash;
      return res.fromDb ? res.fromDb(r) : r;
    };

    const validate = (raw: unknown, now: string): Row => {
      const data = parse(res.schema, raw) as Row;
      if (res.approval) {
        if (data.status === 'approved') {
          if (!String(data.reviewer ?? '').trim()) throw new ApiError(400, 'validation_error', 'reviewer: required to approve');
          if (!data.approvedAt) data.approvedAt = now;
        }
      }
      return data;
    };

    app.get(`/${res.path}`, async (c) => {
      const { results } = await c.env.DB.prepare(`SELECT * FROM ${res.table} ORDER BY id DESC LIMIT 1000`).all<Row>();
      return c.json({ items: results.map(out) });
    });

    app.get(`/${res.path}/:id`, async (c) => {
      const id = parse(idSchema, c.req.param('id'));
      const row = await c.env.DB.prepare(`SELECT * FROM ${res.table} WHERE id = ?`).bind(id).first<Row>();
      if (!row) throw new ApiError(404, 'not_found', 'Not found');
      return c.json(out(row));
    });

    if (!res.noCreate) {
      app.post(`/${res.path}`, async (c) => {
        const body = (await parseBody(c, z.record(z.unknown()))) as Row;
        const reviewer = typeof body.reviewer === 'string' ? body.reviewer : '';
        if (res.path === 'alert-rules' && body.needsReview === false && !reviewer.trim())
          throw new ApiError(400, 'validation_error', 'reviewer: required to clear needsReview');
        let data = validate(body, nowIso(c));
        if (res.toDb) data = res.toDb(data);
        try {
          const r = await c.env.DB.prepare(
            `INSERT INTO ${res.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          )
            .bind(...res.fields.map((f) => data[f] ?? null).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)))
            .run();
          await audit(c, 'create', res.path, { id: r.meta.last_row_id, ...(res.path === 'alert-rules' ? { reviewer } : {}) });
          const row = await c.env.DB.prepare(`SELECT * FROM ${res.table} WHERE id = ?`).bind(r.meta.last_row_id).first<Row>();
          return c.json(out(row!), 201);
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw new ApiError(isFkError(e) ? 409 : 500, isFkError(e) ? 'conflict' : 'db_error', isFkError(e) ? 'Duplicate or referenced item' : 'Database error');
        }
      });
    }

    app.put(`/${res.path}/:id`, async (c) => {
      const id = parse(idSchema, c.req.param('id'));
      const existing = await c.env.DB.prepare(`SELECT * FROM ${res.table} WHERE id = ?`).bind(id).first<Row>();
      if (!existing) throw new ApiError(404, 'not_found', 'Not found');
      const patch = (await parseBody(c, z.record(z.unknown()))) as Row;
      const prev = out(existing);
      const reviewer = typeof patch.reviewer === 'string' ? patch.reviewer : '';
      if (res.path === 'alert-rules' && prev.needsReview === true && patch.needsReview === false && !reviewer.trim())
        throw new ApiError(400, 'validation_error', 'reviewer: required to clear needsReview');
      let data = validate({ ...prev, ...patch }, nowIso(c));
      if (res.toDb) data = res.toDb(data);
      try {
        await c.env.DB.prepare(`UPDATE ${res.table} SET ${cols.map((col) => `${col} = ?`).join(', ')} WHERE id = ?`)
          .bind(...res.fields.map((f) => data[f] ?? null).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)), id)
          .run();
      } catch (e) {
        throw new ApiError(isFkError(e) ? 409 : 500, isFkError(e) ? 'conflict' : 'db_error', 'Could not save');
      }
      await audit(c, 'update', res.path, { id, ...(res.path === 'alert-rules' && reviewer ? { reviewer } : {}) });
      const row = await c.env.DB.prepare(`SELECT * FROM ${res.table} WHERE id = ?`).bind(id).first<Row>();
      return c.json(out(row!));
    });

    app.delete(`/${res.path}/:id`, async (c) => {
      const id = parse(idSchema, c.req.param('id'));
      try {
        const r = await c.env.DB.prepare(`DELETE FROM ${res.table} WHERE id = ?`).bind(id).run();
        if (r.meta.changes === 0) throw new ApiError(404, 'not_found', 'Not found');
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(409, 'conflict', 'Item is still referenced elsewhere');
      }
      await audit(c, 'delete', res.path, { id });
      return c.json({ ok: true });
    });
  }
  return app;
}
