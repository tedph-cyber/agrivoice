# Progress

- 2026-11-14 | T01 | Migration 0001, base seed (37 locations, crops, 3 rules), LGA seeding script, SQL export for D1 | seed.test.ts
- 2026-11-14 | T02 | Core utilities: i18n, GSM-7, truncate/paginate, Q&A scorer, hashing, masking, CSV | packages/core tests
- 2026-11-14 | T03 | USSD engine with paging/back/home/consent/settings/delete | core ussd tests incl. random-input property test
- 2026-11-14 | T04 | Open-Meteo adapter, 3h D1 cache, stale fallback, demo fixture, alert rules | weather.test.ts, boundary tests
- 2026-11-14 | T05 | Public API, rate limits, security headers | public.test.ts
- 2026-11-14 | T06 | USSD AT + simulator endpoints, sessions, farmers, consent, deletion, events | ussd.test.ts
- 2026-11-14 | T07 | Admin auth (PBKDF2, signed cookie, CSRF header), CRUD, moderation, questions, deletions, audit | admin.test.ts
