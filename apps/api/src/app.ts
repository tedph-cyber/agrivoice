import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import type { AppEnv, Deps } from './env';
import { ApiError, errorBody } from './lib/util';
import { securityHeaders } from './lib/security';
import { publicRoutes } from './routes/public';
import { ussdRoutes } from './routes/ussd';
import { adminRoutes } from './routes/admin';

export function createApp(overrides: Partial<Deps> = {}): Hono<AppEnv> {
  const deps: Deps = {
    fetch: overrides.fetch ?? ((...a) => fetch(...a)),
    now: overrides.now ?? (() => new Date()),
  };
  const app = new Hono<AppEnv>();
  app.use('*', securityHeaders);
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  const api = new Hono<AppEnv>();
  api.use(
    '*',
    bodyLimit({
      maxSize: 1_100_000,
      onError: (c) => c.json(errorBody('too_large', 'Request body is too large.'), 413),
    }),
  );
  api.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  });
  api.route('/', publicRoutes);
  api.route('/', ussdRoutes);
  api.route('/admin', adminRoutes);
  api.all('*', (c) => c.json(errorBody('not_found', 'Unknown endpoint'), 404));
  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json(errorBody('validation_error', err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')), 400);
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
    // never log request bodies, phone numbers or secrets
    console.error('unhandled error:', err instanceof Error ? err.name : 'unknown');
    return c.json(errorBody('internal_error', 'Something went wrong.'), 500);
  });
  return app;
}
