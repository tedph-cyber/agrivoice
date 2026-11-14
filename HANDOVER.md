# Hand-over

Built autonomously on 2026-11-14 from `BUILD_SPEC.md`. All tasks T00 to T26 are done; none are blocked. Tags: `demo-ready` (P0 passing) and `v0.1`.

## What is built

- **USSD** (basic phones): first-contact setup with consent, main menu, farm brief, weather and alerts, market prices, ask a question with call-back request, settings including delete-my-data. Pure engine in `packages/core`; every screen is at most 182 characters and GSM 7-bit (asserted in tests, including a random-input test).
- **Website**: `/` , `/demo` (phone simulator), `/brief`, `/prices`, `/prices/report`, `/ask`, `/privacy`, `/admin`. No framework runtime, no inline scripts, each page well under 100 KB, accessibility checked with axe (WCAG A/AA) on every page and admin tab.
- **Weather and alerts**: Open-Meteo adapter, 3-hour cache, stale fallback, offline demo forecast (`DEMO_MODE=1`), three rule types with boundary tests. Alerts from unreviewed thresholds say "Unconfirmed threshold".
- **API**: all public endpoints, admin CRUD and moderation, CSV import and export (7 types, row-level errors, all-or-nothing or skip-invalid), stats, audit log.
- **Privacy and security**: hashed phone numbers, consent, retention job (daily cron plus `npm run purge`), PBKDF2 admin login, signed cookie, CSRF header, rate limits, CSP and friends. See `SECURITY_NOTES.md`.
- **Stretch**: Telegram alerts with a daily cron and de-duplication, Africa's Talking SMS adapter, offline cache (service worker), "Read aloud" via browser speech synthesis.
- **Docs**: `README.md`, `USER_GUIDE.md`, `DEPLOY.md`, `ARCHITECTURE.md`, `SECURITY_NOTES.md`, `DECISIONS.md`, `PROGRESS.md`, `BLOCKERS.md`.

Verification: `npm run check` (lint, typecheck, 124 unit and API tests) and `npm run e2e` (33 Playwright tests: the five P0 flows, admin flows, XSS, page weight and CSP, accessibility, layout shift, offline, read aloud) both pass, including from a fresh clone.

## How to run it

```bash
npm ci
npm run setup:local && npm run db:migrate && npm run db:seed && npm run db:seed:demo
npm run dev        # http://localhost:8787
```

`setup:local` prints the local admin password once; `db:seed:demo` prints one demo price-agent code once. Details in `README.md`. `npx playwright install chromium` once before `npm run e2e` on a new machine.

## How to deploy

Follow `DEPLOY.md` step by step (Cloudflare D1 and Workers, secrets, seeding, Africa's Talking sandbox, smoke tests, rollback). Nothing has been deployed, pushed or run against Cloudflare.

## What is flagged off or demo-only

- Telegram alerts: off until `TELEGRAM_BOT_TOKEN` is set. SMS: adapter only, nobody can subscribe by SMS yet; off until `AT_USERNAME` and `AT_API_KEY` are set.
- English only (`ENABLED_LANGUAGES=en`). The language switch and fallback chain exist; no translations or translated content were supplied.
- All briefs, answers, advice, markets and prices are placeholders flagged "Demo data" (`DEMO:` on USSD). The three alert thresholds are placeholders flagged "Unconfirmed threshold". Audio: none (text-only briefs).
- Demo LGA coordinates fall back to the state capital's point because geocoding could not reach the internet from the build environment (rows are marked `state-point-fallback`).

## Blocked or unverified

No task is blocked. These could not be checked from the build environment and need a look at deploy time (also in `BLOCKERS.md`):

1. **Open-Meteo** request and response format and the geocoding call (network blocked here; adapter tested with mocked HTTP only).
2. **Africa's Talking** USSD callback format (isolated in `adapters/ussd-at.ts`; confirm in the sandbox simulator).
3. **PBKDF2 iterations on Cloudflare**: 600000 (spec) may be refused or too slow; fallback `npm run admin:hash -- "<pw>" --iterations 100000`.
4. **Cloudflare itself**: the Worker was only bundle-checked (no Node imports) and run locally on Node with SQLite behind a D1 shim; `wrangler dev`, D1 and the `_headers` file were not exercised.

## What Ted must supply

- Real content from an agronomist or extension officer with reviewer names and dates: briefs, Q&A, alert advice, confirmed alert thresholds. Real markets and (optional) audio files.
- Team name and contact details (replace the `[brackets]` on `/privacy`), and a qualified person's review of `/privacy`.
- Cloudflare account and production secrets, Africa's Talking sandbox app, optional Telegram bot token.
- A pass through the demo, with changes listed in `TASKS.md` under a new heading "Ted's changes".

## Known risks

- Content correctness rests on human reviewers; the system only enforces that a reviewer and date exist.
- Rate limiting is a D1 counter, good against casual abuse only.
- `PHONE_HASH_SECRET` cannot be rotated without losing saved farmer profiles.
- The local database is SQLite via `node:sqlite` (experimental in Node 22); production uses D1 with the same SQL.
- One admin, no server-side session revocation (see `SECURITY_NOTES.md`).
