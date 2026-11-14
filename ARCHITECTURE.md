# Architecture

One repository, one Cloudflare Worker serving the API (`/api/*`, Hono) and the static Astro site (Workers static assets). Data in D1 (SQLite). Locally the same Hono app runs on Node with a SQLite file behind a D1-compatible shim.

## System

```mermaid
flowchart LR
  Phone[Basic phone] -->|USSD| AT[Africa's Talking]
  AT -->|POST /api/ussd/at/TOKEN| W
  Browser[Smartphone, agent, admin] -->|HTTPS| W
  Sim[/demo simulator/] -->|POST /api/ussd/sim| W
  subgraph W[Cloudflare Worker]
    API[Hono API] --> Core[packages/core: USSD engine, alert rules, i18n, scoring]
    Static[Static site apps/web/dist]
  end
  API --> D1[(D1 database)]
  API -->|forecast, cached 3 h| OM[Open-Meteo]
  Cron[Daily cron] -->|purge| D1
```

## USSD flow

```mermaid
flowchart TD
  Start([Dial]) --> Known{Saved profile?}
  Known -- no --> S[State] --> L[LGA] --> C[Crop] --> Consent{Save place and crop?}
  Consent -- yes: farmers + consents row --> Menu
  Consent -- no: session only --> Menu
  Known -- yes --> Menu
  Menu[Main menu] --> B[1 Farm brief]
  Menu --> Wx[2 Weather and alerts]
  Menu --> P[3 Prices: pick crop, 3 markets]
  Menu --> Q[4 Ask: up to 5 answers]
  Q --> None[6 None of these] --> Topic --> CB{Keep number for call-back?} --> End1([END, questions row])
  Menu --> Set[5 Settings]
  Set --> Lang[Language]
  Set --> Place[Place and crop]
  Set --> Del{Delete my data?} -- yes --> End2([END, farmer and consents removed])
```

State machine: `packages/core/src/ussd.ts`, `step(state, input, ctx)`. The API loads session state from `ussd_sessions`, passes the last `*`-segment as input, and supplies data through a `UssdCtx` (`lib/ussd-ctx.ts`). Every screen is passed through a GSM 7-bit sanitiser and clamped to 182 characters.

## Price approval flow

```mermaid
sequenceDiagram
  participant A as Village agent
  participant API as API
  participant DB as D1
  participant Ad as Admin
  participant F as Farmers (web, USSD)
  A->>API: POST /api/prices/report (code, market, crop, unit, price)
  API->>DB: verify SHA-256(code+pepper), insert status=pending
  Ad->>API: GET /api/admin/prices?status=pending
  Ad->>API: POST /api/admin/prices/:id/approve (cookie + X-Requested-With)
  API->>DB: status=approved, audit row
  F->>API: GET /api/prices, USSD menu 3
  API->>DB: latest approved per market, crop and unit
```

## Data model

```mermaid
erDiagram
  locations ||--o{ farmers : "place"
  farmers ||--o{ consents : has
  crops ||--o{ briefs : for
  crops ||--o{ qa_items : for
  crops ||--o{ alert_advice : for
  alert_rules ||--o{ alert_advice : "rule_key"
  markets ||--o{ price_reports : at
  crops ||--o{ price_reports : of
  reporters ||--o{ price_reports : submitted
  markets ||--o{ reporters : home
  locations ||--o{ forecast_cache : cached
  locations ||--o{ questions : from
```

Standalone tables: `ussd_sessions`, `events` (no personal data), `rate_limits`, `admin_audit`, `deletion_requests`.

## Key decisions

See `DECISIONS.md`. Highlights: content is shown only when `status = approved` and a reviewer and approval date exist; placeholders carry `is_placeholder` end to end; every outside service sits behind an adapter (`apps/api/src/adapters`); the web app has no framework runtime and no inline scripts.
