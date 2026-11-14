import { hashPassword, PBKDF2_ITERATIONS } from '../apps/api/src/lib/auth';

const args = process.argv.slice(2);
const i = args.indexOf('--iterations');
const iterations = i >= 0 ? Number(args[i + 1]) : PBKDF2_ITERATIONS;
const pw = args.filter((_, idx) => idx !== i && idx !== i + 1)[0];
if (!pw || pw.length < 12 || !Number.isInteger(iterations) || iterations < 1000) {
  console.error('Usage: npm run admin:hash -- "<password of at least 12 characters>" [--iterations N]');
  console.error(`Default is ${PBKDF2_ITERATIONS} iterations (BUILD_SPEC section 12). See DEPLOY.md if Cloudflare rejects that many.`);
  process.exit(1);
}
console.log(await hashPassword(pw, iterations));
