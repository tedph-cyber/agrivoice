# AgriVoice: ordered task list

Work top to bottom. A task starts only when its dependencies are ticked. Tick the box when done and add a line to `PROGRESS.md`. After the last P0 task passes, tag the repository `demo-ready`.

Legend: P0 demo-critical, P1 should have, S stretch.

## P0

- [ ] **T00 Scaffold and tooling.** Deps: none.
  Create the npm-workspaces monorepo from `BUILD_SPEC.md` section 4: `apps/api` (Hono, Workers, D1), `apps/web` (Astro, static output), `packages/core`. Add TypeScript strict, ESLint, Prettier, Vitest, Playwright, `wrangler.toml` with a D1 binding named `DB` and static assets from `apps/web/dist`, `.dev.vars.example`, and every command in the CLAUDE.md table (`setup:local` generates random local secrets).
  Verify: `npm run setup:local && npm run check` passes; `npm run dev` serves a placeholder home page and `GET /api/health` returns `{ok:true}`.

- [x] **T01 Schema, migrations, base seed.** Deps: T00.
  Migration `0001_init.sql` exactly as in section 5. `npm run db:migrate` applies it locally. `npm run db:seed` loads: all 36 states plus FCT with state-capital coordinates (use the Open-Meteo geocoding API at seed time with a committed fallback JSON so seeding works offline), crops from `content-templates/crops.csv`, and the three default alert rules with `needs_review = 1`. LGA seeding script `scripts/seed-locations` takes a state name from `NEEDS_FROM_TED.md` (default Ogun) and geocodes its LGAs with fallback to the state point.
  Verify: tests assert row counts, uniqueness constraints, and that re-running the seed is idempotent.

- [x] **T02 Core utilities.** Deps: T00.
  In `packages/core`: i18n loader with fallback chain (language, then `en`) and `en.json` containing every string needed by USSD, alerts and the website (use keys; no hard-coded strings elsewhere); GSM 7-bit validator; text truncation at word boundary with ellipsis; Q&A scorer (section 9); phone hashing (HMAC-SHA-256 via WebCrypto); constant-time compare; masking helper for logs.
  Verify: unit tests for each, including boundary cases.

- [x] **T03 USSD engine.** Deps: T02.
  Implement `step()` and the screens in section 7 as a pure state machine with a data-access interface. Paging, back, home, invalid input, first-contact flow, consent branches, settings and delete flow.
  Verify: exhaustive unit tests with fake data; every rendered screen in every available language is at most 182 characters including prefix and GSM 7-bit only; a property-style test drives random input sequences and asserts the engine never throws and always returns a valid screen.

- [x] **T04 Weather and alerts.** Deps: T01, T02.
  Open-Meteo adapter with 3-hour D1 cache, stale fallback and demo fixture (`DEMO_MODE=1`). Alert rule evaluation in `packages/core`; message templates through i18n; advice lookup requiring approved `alert_advice`.
  Verify: tests with mocked HTTP for success, failure with stale cache, failure without cache; boundary tests for each metric at threshold minus 1, equal, and plus 1.

- [x] **T05 Public API.** Deps: T01, T02, T04.
  Implement the public endpoints in section 6 except USSD: places, crops, forecast, alerts, brief, prices, markets, prices/report, qa/search, questions, privacy/delete-request, stats/public. Rate limiting helper using `rate_limits`. Security headers middleware.
  Verify: API tests for each endpoint; unapproved content never appears; price report becomes visible only after approval (use a test helper for approval until T07 lands); rate limit returns 429.

- [x] **T06 USSD endpoints and farmers.** Deps: T03, T05.
  `POST /api/ussd/at/:token` (Africa's Talking adapter, constant-time token check) and `POST /api/ussd/sim`. Session storage, farmer and consent records, deletion, `events` rows.
  Verify: API tests replaying full sessions as Africa's Talking would send them (cumulative `text`); wrong token returns 404; deletion removes the farmer.

- [x] **T07 Admin auth and admin API.** Deps: T05.
  Login, logout, session cookie, CSRF header check, login rate limit. CRUD endpoints for briefs, qa, alert-advice, alert-rules, markets, crops, reporters (code shown once, hash stored); price moderation; questions queue; deletion requests; audit log.
  Verify: API tests for auth required on every admin route, wrong password, expired session, CSRF header missing, audit rows written, reporter code works once created.

- [ ] **T08 Web foundation.** Deps: T00, T05.
  Layout, navigation, language switch, styles (system fonts, mobile first, AA contrast), "Demo data" badge component, attribution footer, API client with timeout and friendly offline message.
  Verify: pages build; Lighthouse-style checks or a script confirm page weight under 100 KB excluding audio.

- [ ] **T09 Simulator page `/demo`.** Deps: T06, T08.
  Phone-shaped UI that talks to `/api/ussd/sim`, shows exactly what USSD would show, accepts input, supports restart, uses fake numbers.
  Verify: Playwright test for E2E flow 1.

- [ ] **T10 Farm brief page `/brief`.** Deps: T05, T08.
  State, LGA and crop selectors; forecast table; alerts; approved brief with audio player when present; recent prices; badges.
  Verify: Playwright test loads a seeded brief and alert.

- [ ] **T11 Price pages.** Deps: T05, T07, T08.
  `/prices` board and `/prices/report` form.
  Verify: Playwright test for E2E flow 2 (report, admin approval via API, visible).

- [ ] **T12 Ask page `/ask`.** Deps: T05, T08.
  Search with matches; no-match form with consent checkbox.
  Verify: Playwright test for E2E flow 3 up to the question being stored.

- [ ] **T13 Admin interface (minimum).** Deps: T07, T08.
  Login page; dashboard; price moderation; briefs and Q&A (create, edit, approve with reviewer name); questions queue; reporter creation.
  Verify: Playwright tests for E2E flows 2 to 4.

- [ ] **T14 Demo seed.** Deps: T01, T05.
  `npm run db:seed:demo` loads flagged placeholder content from `content-templates/` for the default pilot state and crops, including markets, a few price reports (approved), briefs, Q&A, alert advice, and one reporter code printed to the console. Forecast fixture for demo mode so the demo works offline.
  Verify: after `db:migrate`, `db:seed`, `db:seed:demo`, every public page and every USSD screen shows data, all labelled demo.

- [ ] **T15 End-to-end suite and `demo-ready`.** Deps: T09 to T14.
  Playwright tests for all five flows in section 13. Fix anything that fails.
  Verify: `npm run check && npm run e2e` pass from a clean clone with only the documented setup commands. Then `git tag demo-ready`.

## P1

- [ ] **T16 CSV import and export.** Deps: T07.
  Section 10: validation, row-level error report, all-or-nothing and skip-invalid modes, export, admin UI page, tests using the files in `content-templates/`.

- [ ] **T17 Privacy flows.** Deps: T06, T13.
  `/privacy` page content (plain language, with bracketed placeholders for contact details), web deletion request flow, admin handling, `npm run purge` implementing retention rules, tests.

- [ ] **T18 Security hardening pass.** Deps: T15.
  Review against section 12. Add tests for: CSP and headers present, rate limits on all public POSTs, SQL injection attempts return validation errors, admin XSS attempt stored and rendered safely, USSD token compare, no secrets or phone numbers in logs. Write `SECURITY_NOTES.md` listing controls and known gaps.

- [ ] **T19 Stats.** Deps: T13.
  `GET /api/admin/stats` and an admin page: registrations, sessions by channel and day, prices reported and approved, questions answered, placeholder counter. Public aggregate endpoint already exists.

- [ ] **T20 Documentation.** Deps: T15.
  `README.md` (setup, commands, structure), `USER_GUIDE.md` (farmer USSD, smartphone user, price agent, admin), `DEPLOY.md` (section 14, exact commands, smoke tests, rollback), `ARCHITECTURE.md` with Mermaid diagrams (system, USSD flow, price approval flow, data model).

- [ ] **T21 Performance and accessibility pass.** Deps: T15.
  Check page weight, no layout shift, keyboard navigation, labels, contrast. Fix findings. Add an automated accessibility check to the E2E suite if low effort.

## Stretch (only after P0 and P1 are done)

- [ ] **T22 Telegram alerts.** Notifier adapter for the free Telegram Bot API, subscription by chat, a scheduled Worker (cron trigger) that evaluates alerts per subscribed location and posts them with deduplication. Flagged off unless `TELEGRAM_BOT_TOKEN` is set. Tests with mocks.
- [ ] **T23 Africa's Talking SMS adapter.** Implements the notifier interface; flagged off by default; no real sends in tests.
- [ ] **T24 Offline cache.** Service worker caching `/brief` and `/prices` data for slow connections.
- [ ] **T25 Browser text-to-speech.** Optional "read aloud" button on the brief using the browser's speech synthesis where it supports the language; hidden otherwise.

## Close-out

- [ ] **T26 Handover.** Write `HANDOVER.md` as described in `CLAUDE.md`. Ensure `npm run check` and `npm run e2e` pass. Tag `v0.1`.
