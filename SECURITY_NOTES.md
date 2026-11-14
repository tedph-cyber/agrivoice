# Security notes

Controls checked against `BUILD_SPEC.md` section 12, with the test that proves each one. Local only: nothing here has been exercised on Cloudflare.

## Controls

| Control | Where | Test |
| --- | --- | --- |
| Phone numbers stored only as HMAC-SHA-256 (`PHONE_HASH_SECRET`); raw number only in `questions.contact` with consent, purged after 30 days | `lib/ussd-ctx.ts`, `seed/index.ts` `purge` | `ussd.test.ts`, `seed.test.ts` |
| Consent screens before any save; withdrawal by USSD "Delete my data" and web deletion request | `core/ussd.ts`, `/privacy` | `ussd.test.ts`, e2e flow 5 and deletion test |
| Retention: sessions 1 day, rate limits 1 day, contacts 30 days, events aggregate-only | `npm run purge` | `seed.test.ts` |
| Admin password: PBKDF2-SHA-256, per-hash salt, 600000 iterations by default | `lib/auth.ts`, `npm run admin:hash` | `admin.test.ts` (tests use 1000 iterations for speed; the verifier reads the count from the hash) |
| Admin session: HMAC-signed cookie, `HttpOnly; Secure; SameSite=Strict`, 8 hours | `lib/auth.ts`, `routes/admin.ts` | `admin.test.ts` |
| CSRF: custom `X-Requested-With` header on every state-changing admin request | `routes/admin.ts` | `admin.test.ts` |
| Login rate limit: 5 failures per 15 minutes per IP hash | `routes/admin.ts` | `admin.test.ts`, e2e flow 4 |
| Reporter codes: 8 chars from a 31-letter unambiguous alphabet (about 40 bits), shown once, stored as SHA-256 with a pepper, rate limited per code and per IP | `routes/admin.ts`, `routes/public.ts` | `admin.test.ts`, `public.test.ts` |
| Rate limits on public POSTs: price report, questions, deletion requests, simulator, login; AT endpoint capped per subscriber (300/hour) | `lib/ratelimit.ts` | `public.test.ts`, `ussd.test.ts`, `security.test.ts` |
| Headers on every API response: CSP (no inline script, no eval), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cache-Control: no-store` on `/api/*` | `lib/security.ts`; static files get the same via `apps/web/public/_headers` | `security.test.ts`, e2e `pages.spec.ts` |
| Parameterised SQL only; every input validated with zod; body size limit 1.1 MB | all routes | `security.test.ts`, `public.test.ts` |
| Output encoding: Astro escaping at build time, `textContent`/DOM construction in all client scripts, never `innerHTML` | `apps/web/src/scripts` | e2e stored-XSS test |
| USSD callback token: constant-time compare, 404 on mismatch | `routes/ussd.ts`, `core/crypto.ts` | `security.test.ts`, `ussd.test.ts` |
| CSV export neutralises formula cells (`=`, `+`, `-`, `@`) | `routes/admin-csv.ts` | `csv.test.ts` |
| Logs hold no phone numbers, codes or secrets: the only `console` call logs an error class name | `app.ts` | `security.test.ts` |
| No uploads; audio is a committed file or an https URL; `audioUrl` validated | `routes/admin-crud.ts` | `admin.test.ts` |
| Admin is closed when secrets are missing | `lib/auth.ts` | `security.test.ts` |
| Secrets never in the repo | `.gitignore`, `.dev.vars.example` | `security.test.ts` |

## Known gaps and risks

- **PBKDF2 iterations on Cloudflare.** The spec asks for 600000. Cloudflare Workers may refuse more than 100000 iterations in WebCrypto, and CPU time on the free plan is tight. If login fails after deploy with `hash_unsupported`, generate the hash with `npm run admin:hash -- "<password>" --iterations 100000` and set `ADMIN_PASSWORD_HASH` again. Not verifiable from the build sandbox.
- One admin account, no lockout beyond the per-IP failure limit, no server-side session revocation (logout clears the cookie; a stolen cookie works until it expires in 8 hours; rotate `SESSION_SECRET` to invalidate all).
- Rate limits use a fixed window in D1 and are not atomic under heavy concurrency; they stop casual abuse, not a determined distributed attack. Put Cloudflare rate limiting rules in front for the live service.
- `style-src` allows `'unsafe-inline'` (Astro inlines small stylesheets). Scripts are strict.
- The Africa's Talking callback is protected by a secret path token only; there is no IP allowlist and no signature, because the sandbox does not provide one.
- Changing `PHONE_HASH_SECRET` orphans every saved profile (farmers re-register). Treat it as permanent.
- Weather requests send only coordinates to Open-Meteo; place names never leave the system.
- No dependency audit was possible offline beyond `npm audit` output at install time; run `npm audit` before the live launch.
- Content safety depends on reviewers: the system enforces a reviewer name and date, not that the advice is correct.
