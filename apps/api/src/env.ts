export interface Env {
  DB: D1Database;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
  // vars
  DEMO_MODE?: string;
  ENABLED_LANGUAGES?: string;
  FORECAST_TTL_HOURS?: string;
  // secrets
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  PHONE_HASH_SECRET?: string;
  REPORTER_PEPPER?: string;
  USSD_PATH_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  AT_USERNAME?: string;
  AT_API_KEY?: string;
}

export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: Deps; admin?: string };
};
