// Local database tasks. Local DB is a SQLite file (default .local/dev.sqlite), D1-compatible schema.
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { D1Shim, asD1 } from '../apps/api/src/dev/d1-shim';
import { geocodeLga, lgaStatements, migrate, purge, renderSql, runStatements, seedBase, baseSeedStatements, stateCapitals } from '../apps/api/src/seed/index';
import { seedDemo } from '../apps/api/src/seed/demo';

const root = join(import.meta.dirname, '..');

export function loadDevVars(): Record<string, string> {
  const f = join(root, '.dev.vars');
  const out: Record<string, string> = {};
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
  return out;
}

export function dbPath(): string {
  const p = process.env.AGRIVOICE_DB ?? join(root, '.local', 'dev.sqlite');
  if (p !== ':memory:') mkdirSync(join(p, '..'), { recursive: true });
  return p;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const shim = new D1Shim(dbPath());
  const db = asD1(shim);
  const vars = loadDevVars();
  switch (cmd) {
    case 'migrate': {
      const ran = await migrate(db);
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
      break;
    }
    case 'seed': {
      if (rest.includes('--sql')) {
        // For Cloudflare D1: npm run db:seed -- --sql > seed.sql, then wrangler d1 execute --remote --file seed.sql
        process.stdout.write(renderSql(baseSeedStatements()));
        break;
      }
      await migrate(db);
      await seedBase(db);
      const n = (await db.prepare('SELECT COUNT(*) AS n FROM locations').first<{ n: number }>())?.n;
      console.log(`Base data seeded (${n} locations).`);
      break;
    }
    case 'seed-locations': {
      const state = rest.find((a) => !a.startsWith('--')) ?? 'Ogun';
      const lgas = (JSON.parse(readFileSync(join(root, 'scripts', 'data', 'lgas.json'), 'utf8')) as Record<string, string[]>)[state];
      if (!lgas) throw new Error(`No LGA list bundled for ${state}. Add it to scripts/data/lgas.json.`);
      const cap = stateCapitals().find((c) => c[0] === state);
      if (!cap) throw new Error(`Unknown state ${state}`);
      await migrate(db);
      await seedBase(db);
      const offline = rest.includes('--offline');
      const stmts = await lgaStatements(state, lgas, { lat: cap[2], lon: cap[3] }, offline ? undefined : (name) => geocodeLga(fetch, state, name));
      if (rest.includes('--sql')) process.stdout.write(renderSql(stmts));
      else {
        await runStatements(db, stmts);
        const fb = stmts.filter((s) => s.params[4] === 'state-point-fallback').length;
        console.log(`${state}: ${stmts.length} LGAs seeded (${fb} used the state point).`);
      }
      break;
    }
    case 'seed-demo': {
      await migrate(db);
      await seedBase(db);
      const lg = (JSON.parse(readFileSync(join(root, 'scripts', 'data', 'lgas.json'), 'utf8')) as Record<string, string[]>)['Ogun']!;
      const cap = stateCapitals().find((c) => c[0] === 'Ogun')!;
      const exists = (await db.prepare("SELECT COUNT(*) AS n FROM locations WHERE state = 'Ogun' AND lga IS NOT NULL").first<{ n: number }>())?.n;
      if (!exists) await runStatements(db, await lgaStatements('Ogun', lg, { lat: cap[2], lon: cap[3] }));
      const { reporterCode } = await seedDemo(db, { pepper: vars.REPORTER_PEPPER ?? process.env.REPORTER_PEPPER ?? '' });
      console.log('Demo content seeded (all flagged "Demo data").');
      if (reporterCode) console.log(`Demo price-agent code (shown once): ${reporterCode}`);
      else console.log('Demo reporter already exists; its code was shown when first created.');
      break;
    }
    case 'purge': {
      await migrate(db);
      console.log('Purged:', await purge(db));
      break;
    }
    default:
      console.error('Usage: db.ts migrate|seed|seed-locations|seed-demo|purge');
      process.exit(1);
  }
  shim.close();
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
