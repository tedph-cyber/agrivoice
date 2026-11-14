import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { ROOT } from '../src/seed/index';

it('the Worker entry bundles for a non-Node runtime (no node: imports, no filesystem)', async () => {
  const r = await build({
    entryPoints: [join(ROOT, 'apps/api/src/index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser', 'import'],
    logLevel: 'silent',
  });
  const out = r.outputFiles[0]!.text;
  expect(out).not.toMatch(/from ["']node:/);
  expect(out.length).toBeGreaterThan(10_000);
  expect(out.length).toBeLessThan(900_000);
});
