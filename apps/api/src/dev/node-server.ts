// Local server: the same Hono app as the Worker, SQLite file as the database, static site from apps/web/dist.
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../app';
import type { Env } from '../env';
import { SECURITY_HEADERS } from '../lib/security';
import { D1Shim, asD1 } from './d1-shim';
import { migrate, seedBase } from '../seed/index';
import { loadDevVars, dbPath } from '../../../../scripts/db';

const root = join(import.meta.dirname, '..', '..', '..', '..');
const webDist = join(root, 'apps', 'web', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export async function startServer(port = Number(process.env.PORT ?? 8787), opts: { db?: string; vars?: Record<string, string>; fetch?: typeof fetch; quiet?: boolean } = {}) {
  const shim = new D1Shim(opts.db ?? dbPath());
  const db = asD1(shim);
  await migrate(db);
  await seedBase(db);
  const vars = { ENABLED_LANGUAGES: 'en', ...loadDevVars(), ...opts.vars };
  const env = { DB: db, ...vars } as unknown as Env;
  const app = createApp(opts.fetch ? { fetch: opts.fetch } : {});
  const server = serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/')) return app.fetch(req, env);
      return staticFile(url.pathname);
    },
  });
  if (!opts.quiet) console.log(`AgriVoice running at http://localhost:${port}`);
  return { server, shim, close: () => { server.close(); shim.close(); } };
}

async function staticFile(pathname: string): Promise<Response> {
  let rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const tryPaths = [rel, join(rel, 'index.html'), rel + '.html'];
  for (const p of tryPaths) {
    const full = join(webDist, p);
    if (!full.startsWith(webDist)) continue;
    try {
      if ((await stat(full)).isFile()) {
        return new Response(await readFile(full), { headers: { ...SECURITY_HEADERS, 'content-type': TYPES[extname(full)] ?? 'application/octet-stream' } });
      }
    } catch { /* next */ }
  }
  rel = '';
  return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
}

if (import.meta.url === `file://${process.argv[1]}`) await startServer();
