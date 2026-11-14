# Decisions

One line each: date, question, choice, reason.

- 2026-11-14 | Where does the local database live? | A SQLite file (`.local/dev.sqlite`) through a D1-compatible shim over `node:sqlite`, used by `npm run dev`, tests and e2e. | `wrangler d1 execute` is denied by settings, workerd may not run in every environment, and the SQL schema is identical. `wrangler.toml` and `migrations/` stay valid for Cloudflare, so Ted deploys with D1.
- 2026-11-14 | How do tests reach the API? | `app.request()` against the Hono app with the shim database and a mocked `fetch`. | Fast, deterministic, no live calls.
- 2026-11-14 | Open-Meteo field names could not be verified against live docs (network blocked in the build sandbox). | Used the documented daily variables from BUILD_SPEC section 8 and the standard `daily.time[]` response shape; adapter is isolated in `adapters/weather-openmeteo.ts`. | Tests use mocked HTTP only. Listed under BLOCKERS "Verify".
- 2026-11-14 | Same for the Africa's Talking USSD format. | Implemented `sessionId, serviceCode, phoneNumber, text, networkCode` form fields and `CON `/`END ` replies as in BUILD_SPEC section 6. | Isolated in `adapters/ussd-at.ts`. Verify in the AT sandbox at deploy time.
- 2026-11-14 | USSD engine async? | `step()` is an async function with an injected data interface. | Data access is I/O; the engine itself holds no I/O and is tested with fakes.
- 2026-11-14 | Which crops appear on USSD? | Crops with at least one approved brief, Q&A item or approved price. | BUILD_SPEC section 7 ("crops that have approved content"). With only base seed, USSD says no crops are set up.
- 2026-11-14 | Q&A scoring normalisation. | Weight 2 for keyword hits and 1 for question hits, divided by 2 x query tokens. | A query fully matching the question text scores 0.5, so the 0.35 threshold lets it through while single stray words do not.
- 2026-11-14 | GSM 7-bit validation. | Basic table only; extension-table characters (euro, brackets) are treated as invalid. | They cost two septets and may be rejected by some gateways.
- 2026-11-14 | Dev dependency `tsx`, `@hono/node-server`. | Added. | Run TypeScript scripts and the local server; both are boring and free.
- 2026-11-14 | Admin login rate limit. | 5 failed attempts per 15 minutes per IP hash, then 429. Only failures count. | Blocks brute force without locking out a correct login.
- 2026-11-14 | Reporter code lookup. | Rate limit per code hash and per IP hash before the lookup. | Stops code guessing.
