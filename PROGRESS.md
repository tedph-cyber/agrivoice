# Progress

- 2026-11-14 | T01 | Migration 0001, base seed (37 locations, crops, 3 rules), LGA seeding script, SQL export for D1 | seed.test.ts
- 2026-11-14 | T02 | Core utilities: i18n, GSM-7, truncate/paginate, Q&A scorer, hashing, masking, CSV | packages/core tests
- 2026-11-14 | T03 | USSD engine with paging/back/home/consent/settings/delete | core ussd tests incl. random-input property test
- 2026-11-14 | T04 | Open-Meteo adapter, 3h D1 cache, stale fallback, demo fixture, alert rules | weather.test.ts, boundary tests
- 2026-11-14 | T05 | Public API, rate limits, security headers | public.test.ts
- 2026-11-14 | T06 | USSD AT + simulator endpoints, sessions, farmers, consent, deletion, events | ussd.test.ts
- 2026-11-14 | T07 | Admin auth (PBKDF2, signed cookie, CSRF header), CRUD, moderation, questions, deletions, audit | admin.test.ts
- 2026-11-14 | T00 | Monorepo scaffold, tooling, all commands in CLAUDE.md table, wrangler.toml, .dev.vars.example | npm run check green; dev server serves / and /api/health
- 2026-11-14 | T08 | Astro layout, nav, language switch, Demo badge, attribution, API client with timeout | e2e pages.spec.ts: each page < 100 KB, no inline scripts, no console errors
- 2026-11-14 | T09 | /demo simulator | e2e flow 1
- 2026-11-14 | T10 | /brief page | e2e brief test
- 2026-11-14 | T11 | /prices and /prices/report | e2e flow 2
- 2026-11-14 | T12 | /ask | e2e flow 3
- 2026-11-14 | T13 | Admin UI (dashboard, prices, briefs, Q&A, advice, rules, markets, crops, agents, questions, deletions) | e2e flows 2-4
- 2026-11-14 | T14 | Demo seed with flagged content and one reporter code | seed.test.ts, e2e
