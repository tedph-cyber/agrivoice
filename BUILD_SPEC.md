# AgriVoice: build specification (lean MVP)

Status: authoritative. Requirements here are fixed. Clarifications go in the last section.

## 1. Product

AgriVoice gives smallholder farmers in Nigeria four things:

1. **Farm brief**: a weekly, approved, plain-language brief per state and crop, with an optional recorded voice note.
2. **Weather and alerts**: a short forecast for the farmer's place, and rule-based alerts (heavy rain, dry spell, heat).
3. **Market prices**: a price board filled by village agents and approved by an admin.
4. **Ask**: answers to common questions from an approved Q&A, with a call-back or agent queue when nothing fits.

Access channels:

- **USSD** for basic phones with no mobile data. For the challenge this runs in a built-in simulator and in the Africa's Talking sandbox. A live Nigerian short code comes after funding.
- **Website** for smartphone users, extension agents and admins.

No AI-generated advice. No paid services. All agronomic content is entered by people and approved before it is shown.

Context: submission to the USPF Changemaker Challenge 2026, Agriculture sector (advisory tools and market information designed for low-resource settings).

## 2. Users

| User | Needs | Channel |
| --- | --- | --- |
| Farmer, basic phone | Brief, weather, prices, answers; no data | USSD |
| Farmer or extension agent, smartphone | Same, plus audio | Website |
| Village price agent | Report market prices quickly | Website form with a short code |
| Admin | Manage content, approve prices, answer questions | Admin website |

## 3. Scope tiers

- **P0 (demo-critical):** everything needed for the 3-minute demo: scaffold, database, USSD engine and simulator, weather and alerts, public API, minimal admin, web pages (`/demo`, `/brief`, `/prices`, `/prices/report`, `/ask`), demo data, end-to-end tests.
- **P1:** complete admin, CSV import and export, privacy flows, security hardening, stats, documentation, performance and accessibility pass.
- **Stretch (only after P0 and P1):** Telegram alerts with a scheduled job, Africa's Talking SMS adapter behind a flag, offline caching, browser text-to-speech.
- **Out of scope:** live USSD code, outbound calls, speech-to-text, LLM answers, payments, native apps, farmer bulk import.

## 4. Architecture and repository layout

Single repository, npm workspaces, deployed as one Cloudflare Worker that serves the API and the static website.

```
/apps/api        Hono on Cloudflare Workers, D1 database, TypeScript
/apps/web        Astro with static output, small vanilla scripts, no heavy framework
/packages/core   Pure TypeScript: USSD engine, alert rules, i18n, text utilities, scoring
/migrations      SQL migrations for D1
/content-templates  CSV templates (provided; do not delete)
/scripts         setup, seed, import, purge, admin hash
```

- Worker routes `/api/*` to Hono; all other paths serve static assets from `apps/web/dist` (Workers static assets).
- Database: Cloudflare D1 (SQLite). Local development uses wrangler's local D1.
- Config in `wrangler.toml`: D1 binding `DB`, assets directory, non-secret vars. Secrets come from `.dev.vars` locally and `wrangler secret` at deploy (done by Ted).
- Adapters in `apps/api/src/adapters/`: `ussd-at.ts` (Africa's Talking format), `weather-openmeteo.ts`, `notifier.ts` (interface with `mock`, `telegram`, `at-sms` implementations; `mock` is the default).

## 5. Data model (migration `0001_init.sql`)

```sql
CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  lga TEXT,                         -- NULL = state-level point
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  source TEXT,                      -- e.g. 'open-meteo-geocoding', 'csv'
  UNIQUE (state, lga)
);
CREATE TABLE crops (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  names_json TEXT NOT NULL DEFAULT '{}'   -- {"pcm":"...","ha":"...","yo":"...","ig":"..."}
);
CREATE TABLE markets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  lga TEXT,
  lat REAL, lon REAL,
  is_placeholder INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reporters (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,   -- SHA-256(code + REPORTER_PEPPER)
  display_name TEXT NOT NULL,
  market_id INTEGER REFERENCES markets(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE price_reports (
  id INTEGER PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  crop_id INTEGER NOT NULL REFERENCES crops(id),
  unit TEXT NOT NULL,               -- e.g. 'bag', 'basket', 'kg'
  price_ngn INTEGER NOT NULL CHECK (price_ngn > 0),
  reported_at TEXT NOT NULL,
  reporter_id INTEGER REFERENCES reporters(id),
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reviewed_at TEXT,
  is_placeholder INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE briefs (
  id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  crop_id INTEGER NOT NULL REFERENCES crops(id),
  language TEXT NOT NULL DEFAULT 'en',
  week_start TEXT NOT NULL,         -- ISO date (Monday)
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  ussd_summary TEXT,                -- <= 140 chars; if NULL, truncate body at a word boundary
  audio_url TEXT,
  reviewer TEXT,
  approved_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | approved | archived
  is_placeholder INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE qa_items (
  id INTEGER PRIMARY KEY,
  crop_id INTEGER REFERENCES crops(id),     -- NULL = general
  language TEXT NOT NULL DEFAULT 'en',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  reviewer TEXT,
  approved_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_placeholder INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE alert_rules (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,         -- heavy_rain | dry_spell | heat
  metric TEXT NOT NULL,             -- precip_day_mm | dry_days_consecutive | tmax_c
  operator TEXT NOT NULL DEFAULT '>=',
  threshold REAL NOT NULL,
  window_days INTEGER NOT NULL,
  severity TEXT NOT NULL DEFAULT 'watch',   -- watch | warning
  enabled INTEGER NOT NULL DEFAULT 1,
  needs_review INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE alert_advice (
  id INTEGER PRIMARY KEY,
  rule_key TEXT NOT NULL REFERENCES alert_rules(key),
  crop_id INTEGER REFERENCES crops(id),     -- NULL = any crop
  language TEXT NOT NULL DEFAULT 'en',
  text TEXT NOT NULL,
  reviewer TEXT,
  approved_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_placeholder INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE forecast_cache (
  location_id INTEGER PRIMARY KEY REFERENCES locations(id),
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE farmers (
  id INTEGER PRIMARY KEY,
  phone_hash TEXT NOT NULL UNIQUE,  -- HMAC-SHA-256(phone, PHONE_HASH_SECRET)
  language TEXT NOT NULL DEFAULT 'en',
  location_id INTEGER REFERENCES locations(id),
  crop_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE consents (
  id INTEGER PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,            -- 'profile' | 'callback'
  given_at TEXT NOT NULL,
  withdrawn_at TEXT
);
CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,            -- 'ussd' | 'web'
  language TEXT NOT NULL DEFAULT 'en',
  text TEXT NOT NULL,
  location_id INTEGER REFERENCES locations(id),
  contact TEXT,                     -- raw phone ONLY with explicit consent; purged after 30 days
  status TEXT NOT NULL DEFAULT 'open',      -- open | answered | closed
  answer TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE deletion_requests (
  id INTEGER PRIMARY KEY,
  note TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE TABLE ussd_sessions (
  session_id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE events (                -- usage stats; no personal data
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  channel TEXT NOT NULL,            -- ussd | web | sim
  kind TEXT NOT NULL,               -- session | brief | weather | prices | ask | register
  state TEXT
);
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  detail TEXT
);
```

Content rule: a row of `briefs`, `qa_items` or `alert_advice` is shown to farmers only if `status = 'approved'`, `reviewer` is not empty and `approved_at` is not null. A price report is shown only if `status = 'approved'`.

## 6. API

All responses are JSON unless stated. All inputs validated with zod. Error shape: `{ "error": { "code": "string", "message": "string" } }` with a proper HTTP status.

### Public

| Method and path | Purpose |
| --- | --- |
| `GET /api/places` | Lists states. `?state=Ogun` lists LGAs for that state. Each item has the `locationId` |
| `GET /api/crops` | Lists crops that have names in the requested `?lang=` (fallback English) |
| `GET /api/forecast?locationId=` | `{location, fetchedAt, source:"open-meteo", stale, days:[{date, precipMm, tmaxC, tminC, popPct}]}` for 7 days |
| `GET /api/alerts?locationId=&cropId=&lang=` | Active alerts: `[{ruleKey, severity, date, message, advice|null, needsReview, isPlaceholder}]` |
| `GET /api/brief?state=&cropId=&lang=` | Latest approved brief for the state, crop and language (fallback English), else 404 |
| `GET /api/prices?cropId=&state=&marketId=` | Latest approved report per market and unit, with `ageDays`, sorted newest first |
| `GET /api/markets?state=` | Markets for the price form |
| `POST /api/prices/report` | Body `{reporterCode, marketId, cropId, unit, priceNgn}`. Rate limited. Creates a `pending` report |
| `GET /api/qa/search?q=&lang=&cropId=` | Top 3 approved matches with a `score` between 0 and 1 |
| `POST /api/questions` | Body `{text, language, locationId?, contact?, consentContact}`. `contact` is stored only if `consentContact` is true |
| `POST /api/privacy/delete-request` | Body `{note?, contact?}`; creates a deletion request for admin handling |
| `GET /api/stats/public` | Aggregate counts only; no personal data |
| `POST /api/ussd/at/:token` | Africa's Talking callback. `application/x-www-form-urlencoded` fields `sessionId, serviceCode, phoneNumber, text, networkCode`. Replies `text/plain` starting `CON ` or `END `. `:token` must equal `USSD_PATH_TOKEN` (constant-time compare). Verify the format against current Africa's Talking documentation; keep it isolated in the adapter |
| `POST /api/ussd/sim` | Simulator endpoint. JSON `{sessionId, phone, text}` returning `{text, end}`. Uses fake numbers only; rate limited; stores no `phone_hash` for simulator numbers unless the simulator user consents, exactly like USSD |

### Admin (session cookie, see section 12)

- `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`
- CRUD with `GET`, `POST`, `PUT`, `DELETE` on: `briefs`, `qa`, `alert-advice`, `alert-rules`, `markets`, `crops`, `reporters`
- `GET /api/admin/prices?status=pending`, `POST /api/admin/prices/:id/approve`, `POST /api/admin/prices/:id/reject`
- `GET /api/admin/questions?status=open`, `POST /api/admin/questions/:id/answer`
- `GET /api/admin/deletion-requests`, `POST /api/admin/deletion-requests/:id/done`
- `POST /api/admin/import/:type` (CSV upload, see section 10), `GET /api/admin/export/:type`
- `GET /api/admin/stats`
- Every write appends to `admin_audit`.

## 7. USSD specification

Engine: pure function in `packages/core`: `step(sessionState, input, ctx) -> {state, screen, end}`. The API layer loads and saves session state in `ussd_sessions` and supplies data through a `ctx` data-access interface (so the engine is testable with fakes).

Input handling: Africa's Talking sends cumulative `text` such as `1*2*3`. Take the last `*`-separated segment as the new input; an empty `text` means a new session. `0` goes back one screen, `00` goes to the main menu (except on the first screen). Invalid input re-shows the screen with a short "Invalid choice" line if it still fits.

Limits: every response, including the `CON ` or `END ` prefix, is at most 182 characters and uses only GSM 7-bit characters. Write `N` for naira. Long text is split into pages with `1 Next` and `0 Back`. Assert limits in tests for all screens and languages.

Session: expires after 5 minutes of inactivity; `ussd_sessions` rows older than 1 day are purged.

Flow:

1. **First contact** (phone not in `farmers`, or no saved profile): language (only enabled languages) then state (paged, 6 per page, `7 More`) then LGA (paged) then crop (from crops that have approved content) then consent screen.
   Consent text (English): `Save your place and crop? We keep a scrambled code, not your number. 1 Yes 2 No`. `Yes` creates `farmers` and a `consents` row (purpose `profile`). `No` keeps choices for this session only.
2. **Main menu**: `1 Farm brief`, `2 Weather and alerts`, `3 Market prices`, `4 Ask a question`, `5 My settings`.
3. **1 Farm brief**: shows `ussd_summary` of the latest approved brief for state and crop, or a "no brief yet" screen. Placeholder content is prefixed `DEMO:`.
4. **2 Weather and alerts**: first line is the most severe active alert if any, then tomorrow and the next two days as `precip mm, min-max C`. Shows "updated hh:mm" and a "stale" note if the forecast is older than 6 hours.
5. **3 Market prices**: pick a crop, then up to 3 markets in the farmer's state: `Market: N price per unit (age)`.
6. **4 Ask a question**: list up to 5 approved questions for the crop (then general), choose one to read the answer (paged). Option `6 None of these` leads to a call-back request: ask the farmer to pick a topic from a fixed list (no free text on USSD), ask for explicit consent to keep their number for a call-back, and store a `questions` row with `contact` only if they say yes.
7. **5 My settings**: `1 Language`, `2 Place and crop`, `3 Delete my data`. Deletion asks for confirmation, then removes the `farmers` row and its `consents`. Call-back requests are not linked to the hashed profile, so the screen says they are removed within 30 days.
8. Every successful menu use writes one `events` row (no personal data).

All screen strings live in the i18n files with keys, not in code.

## 8. Weather and alerts

- Source: Open-Meteo forecast API, free for non-commercial use, no key. Request daily variables `precipitation_sum`, `temperature_2m_max`, `temperature_2m_min`, `precipitation_probability_max`, `timezone=Africa/Lagos`, `forecast_days=7`. Verify names against the current Open-Meteo documentation. Show attribution ("Weather data by Open-Meteo.com") on the website.
- Cache per `locations.id` in `forecast_cache`, valid for 3 hours. If the request fails, serve the stale cache with `stale: true`. If there is no cache, serve a bundled fixture only when `DEMO_MODE=1`; otherwise return a clear error.
- Place coordinates: states use the state capital's point; LGAs use coordinates from the Open-Meteo geocoding API at seed time (`scripts/seed-locations`), falling back to the state point if not found. Store `source`.
- Rules (`alert_rules`), evaluated in `packages/core`:
  - `precip_day_mm`: maximum daily precipitation within the next `window_days` days is at or above `threshold`.
  - `dry_days_consecutive`: longest run of consecutive days with precipitation below 1 mm, within `window_days`, is at or above `threshold`.
  - `tmax_c`: maximum daily temperature within `window_days` is at or above `threshold`.
- Default rows are seeded with `needs_review = 1` and these placeholder thresholds: `heavy_rain` (precip_day_mm, 50, window 3, warning), `dry_spell` (dry_days_consecutive, 7, window 7, watch), `heat` (tmax_c, 38, window 3, watch). They are placeholders, not agronomic guidance. The UI labels any alert from a `needs_review` rule "Unconfirmed threshold".
- Alert message is the factual forecast only, built from i18n templates, for example "Heavy rain forecast for {place} on {date}: {mm} mm". Advice text appears only if an approved `alert_advice` row matches the rule, crop and language; otherwise show none.

## 9. Website

Static Astro pages with small vanilla scripts that call `/api/*`. System fonts. Mobile first. A language switch is on every page; missing strings fall back to English.

| Path | Content |
| --- | --- |
| `/` | What it is, who it is for, link to the demo, how to dial (sandbox note), attribution |
| `/demo` | Phone-shaped USSD simulator: fake number field, keypad-style input, screen text exactly as USSD would show it, restart button |
| `/brief` | Choose state, LGA, crop. Shows forecast table, alerts, approved brief with an audio player if `audio_url` exists, recent prices. "Demo data" badges where relevant |
| `/prices` | Price board by crop and state; report age shown |
| `/prices/report` | Form: agent code, market, crop, unit, price. Confirms "sent for approval" |
| `/ask` | Search box; shows the top matches; if none scores above the threshold, a form to send the question to an agent with optional contact and a consent checkbox |
| `/privacy` | Plain-language notice, what is stored, how to delete, contact placeholders |
| `/admin` | Admin application (see section 11) |

Q&A search scoring: lowercase, strip punctuation, tokenise, remove a short English stop list, score as weighted token overlap between the query and `question + keywords` (keywords weighted higher), normalised to 0 to 1. Show matches with score at or above 0.35 (configurable constant). No external AI.

## 10. Content import and export

CSV files with a header row, UTF-8. Templates are in `content-templates/`. Import must validate every row, report row-level errors, and apply all valid rows or none (single transaction) depending on a `?mode=all-or-nothing|skip-invalid` flag (default all-or-nothing). Imported rows from templates keep `is_placeholder` as given. References by `crop_slug` and `rule_key`. Export returns the same columns.

Types: `crops`, `locations`, `markets`, `briefs`, `qa`, `alert-rules`, `alert-advice`.

## 11. Admin application

Static pages under `/admin` calling `/api/admin/*`. Pages: Dashboard (placeholder counter, open questions, pending prices), Prices (approve or reject, bulk approve), Briefs, Q&A, Alert advice, Alert rules (edit thresholds; clear `needs_review` only with a reviewer name), Markets and Reporters (create reporter, show the generated code once, store only the hash), Questions queue, Deletion requests, Import and export, Stats. Use `textContent`, never `innerHTML`, for user-supplied text.

## 12. Privacy and security

- Phone numbers: store only an HMAC-SHA-256 hash (`PHONE_HASH_SECRET`). Raw number only in `questions.contact` with explicit consent; purged after 30 days by `npm run purge`.
- Consent screens in plain language before any save. Withdrawal and deletion via USSD option 5 and the web deletion request.
- Retention (enforced by `npm run purge`): `ussd_sessions` 1 day, `rate_limits` 1 day, `questions.contact` 30 days, `events` kept as aggregates only.
- Admin auth: one admin. Password verified against `ADMIN_PASSWORD_HASH` (PBKDF2 via WebCrypto, 600000 iterations, per-hash salt; `npm run admin:hash` creates it). Session: signed cookie (HMAC with `SESSION_SECRET`), `HttpOnly`, `Secure`, `SameSite=Strict`, 8-hour expiry. State-changing admin requests require a custom header (`X-Requested-With`) in addition to the cookie. Login is rate limited.
- Reporter codes: 8 characters from an unambiguous alphabet, shown once at creation, stored as SHA-256 with `REPORTER_PEPPER`. Reporter submissions are rate limited per code and per IP.
- Rate limits via the `rate_limits` table: public POST endpoints, simulator, login.
- Headers on every response: strict `Content-Security-Policy` (no inline scripts if feasible, otherwise hashed), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Frame-Options: DENY`.
- No file uploads in this MVP. Audio is added by URL or by a file committed to the static assets.
- SQL: parameterised only. Output encoding: Astro's escaping; admin uses `textContent`.
- Logs: no phone numbers, no codes, no secrets.
- Secrets (never in the repo): `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `PHONE_HASH_SECRET`, `REPORTER_PEPPER`, `USSD_PATH_TOKEN`. Optional: `TELEGRAM_BOT_TOKEN`, `AT_USERNAME`, `AT_API_KEY`.

## 13. Testing

- Unit tests (Vitest) for: USSD engine (every screen, back, home, invalid input, paging, 182-character and GSM 7-bit limits in every language), alert rules (boundary values), Q&A scoring, text truncation, phone hashing.
- API tests for: each public endpoint, content-approval filtering, price report to approval to visibility, rate limits, admin auth, CSV import errors.
- End-to-end tests (Playwright), the P0 flows:
  1. Simulator: first-time setup, main menu, brief, weather, prices, ask.
  2. Agent submits a price, admin approves, it appears on `/prices` and in USSD.
  3. Question with no match is sent, appears in the admin queue, admin answers.
  4. `/admin` is inaccessible without login; wrong password is rejected and rate limited.
  5. Deletion through USSD removes the farmer record.
- Weather tests use mocked HTTP; no live calls in tests.
- `npm run check` must pass before every commit.

## 14. Deployment (written up in `DEPLOY.md` by the agent; run by Ted)

Cloudflare Workers with D1 and static assets, free tier. `DEPLOY.md` must list exact commands in order: sign in to wrangler, create the D1 database and paste its id into `wrangler.toml`, apply migrations with `--remote`, set each secret, deploy, seed base data, create the first reporter codes in the admin, connect the Africa's Talking sandbox (create an app, add a USSD channel, set the callback URL to `https://<worker-host>/api/ussd/at/<USSD_PATH_TOKEN>`, test with the sandbox simulator). Include rollback steps and a post-deploy smoke test list. The agent must not run any of these commands.

## 15. Placeholder and demo policy

- `npm run db:seed` loads base data only: states, crops from the template, default alert rules. No briefs, answers, markets or prices.
- `npm run db:seed:demo` adds flagged demo content (`is_placeholder = 1`) from `content-templates/` so every screen works end to end. It never runs in production unless Ted runs it.
- Every API object derived from placeholder data includes `isPlaceholder: true`; every interface shows "Demo data"; USSD prefixes `DEMO:`.
- The admin dashboard shows how many placeholder rows remain.

## 16. Non-goals

Live SMS or voice, speech recognition, LLM answers, payments, accounts for farmers, push notifications (other than the Telegram stretch), analytics beyond aggregate counts.

## Clarifications

(The agent appends clarifications here.)
