-- AgriVoice initial schema (BUILD_SPEC.md section 5)
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
