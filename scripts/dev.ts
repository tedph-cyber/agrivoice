import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const run = (cmd: string, args: string[]) =>
  new Promise<void>((res, rej) => spawn(cmd, args, { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} failed`)))));

if (!existsSync(join(root, '.dev.vars'))) await run('npm', ['run', 'setup:local']);
await run('npm', ['run', 'build', '-w', 'apps/web']);
await import('../apps/api/src/dev/node-server');
