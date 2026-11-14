-- Stretch T22: Telegram alert subscriptions and de-duplication of sent alerts.
CREATE TABLE telegram_subscriptions (
  chat_id TEXT PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  crop_id INTEGER NOT NULL REFERENCES crops(id),
  language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);
CREATE TABLE alert_dispatches (
  chat_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  alert_date TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, rule_key, alert_date)
);
