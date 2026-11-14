// Starts an isolated server for Playwright: fresh SQLite file, demo content, offline weather, known admin password.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { D1Shim, asD1 } from '../apps/api/src/dev/d1-shim';
import { migrate, seedBase } from '../apps/api/src/seed/index';
import { seedDemo } from '../apps/api/src/seed/demo';
import { hashPassword } from '../apps/api/src/lib/auth';
import { startServer } from '../apps/api/src/dev/node-server';

export const E2E_PASSWORD = 'e2e-admin-password';
const root = join(import.meta.dirname, '..');
mkdirSync(join(root, '.local'), { recursive: true });
const file = join(root, '.local', 'e2e.sqlite');
rmSync(file, { force: true });

const vars = {
  ADMIN_PASSWORD_HASH: await hashPassword(E2E_PASSWORD),
  SESSION_SECRET: 'e2e-session-secret-'.padEnd(64, 'x'),
  PHONE_HASH_SECRET: 'e2e-phone-secret-'.padEnd(64, 'x'),
  REPORTER_PEPPER: 'e2e-pepper-'.padEnd(64, 'x'),
  USSD_PATH_TOKEN: 'e2e-token',
  DEMO_MODE: '1',
  ENABLED_LANGUAGES: 'en',
};
const prep = new D1Shim(file);
const db = asD1(prep);
await migrate(db);
await seedBase(db);
const { lgaStatements, runStatements } = await import('../apps/api/src/seed/index');
const ogun = (await db.prepare("SELECT lat, lon FROM locations WHERE state = 'Ogun' AND lga IS NULL").first<{ lat: number; lon: number }>())!;
await runStatements(db, await lgaStatements('Ogun', ['Abeokuta North', 'Ifo', 'Ijebu Ode'], ogun));
await seedDemo(db, { pepper: vars.REPORTER_PEPPER });
prep.close();

const offline = (() => Promise.reject(new Error('offline in e2e'))) as unknown as typeof fetch;
await startServer(Number(process.env.E2E_PORT ?? 8799), { db: file, vars, fetch: offline, quiet: true });
