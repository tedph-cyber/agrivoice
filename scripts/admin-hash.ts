import { hashPassword, PBKDF2_ITERATIONS } from '../apps/api/src/lib/auth';

const args = process.argv.slice(2);
const i = args.indexOf('--iterations');
const iterations = i >= 0 ? Number(args[i + 1]) : PBKDF2_ITERATIONS;
const o = args.indexOf('--out');
const out = o >= 0 ? args[o + 1] : undefined;
const pw = args.filter((_, idx) => ![i, i + 1, o, o + 1].some((x) => x >= 0 && x === idx))[0];
if (!pw || pw.length < 12 || !Number.isInteger(iterations) || iterations < 1000) {
  console.error('Usage: npm run admin:hash -- "<password of at least 12 characters>" [--iterations N]');
  console.error(`Default is ${PBKDF2_ITERATIONS} iterations (BUILD_SPEC section 12). See DEPLOY.md if Cloudflare rejects that many.`);
  process.exit(1);
}
const hash = await hashPassword(pw, iterations);
if (out) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, hash, 'utf8'); // plain UTF-8, no newline, no BOM
  console.log(`Wrote ${hash.length} characters to ${out}`);
} else console.log(hash);
