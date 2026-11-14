# Deploying AgriVoice to Cloudflare (free tier)

Run by Ted, from a machine with Node 22+. The coding agent never runs these commands. Everything here is untested against a real Cloudflare account; follow the smoke tests at the end.

Prerequisites: a free Cloudflare account, this repository, `npm ci` done.

## 1. Sign in

```bash
npx wrangler login
```

## 2. Create the database

```bash
npx wrangler d1 create agrivoice
```

Copy the printed `database_id` into `wrangler.toml` (`database_id = "..."`). Commit that change; the id is not a secret.

## 3. Apply the schema to the remote database

```bash
npx wrangler d1 migrations apply agrivoice --remote
```

## 4. Set the secrets

Each value is a random secret that nobody needs to read. Do not reuse your local `.dev.vars` values.

```bash
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
openssl rand -hex 32 | npx wrangler secret put PHONE_HASH_SECRET
openssl rand -hex 32 | npx wrangler secret put REPORTER_PEPPER
openssl rand -hex 24 | npx wrangler secret put USSD_PATH_TOKEN
npm run -s admin:hash -- "<a long admin password, 12+ characters>"     # prints a hash
npx wrangler secret put ADMIN_PASSWORD_HASH                            # paste the hash when asked
```

Keep a private note of the `USSD_PATH_TOKEN` value (you need it for the Africa's Talking callback URL; read it from your own run, `wrangler` cannot show it again). `PHONE_HASH_SECRET` is permanent: changing it orphans saved farmer profiles.

If admin login later fails with `hash_unsupported` (Cloudflare may refuse 600000 PBKDF2 iterations), regenerate with `npm run -s admin:hash -- "<password>" --iterations 100000` and set `ADMIN_PASSWORD_HASH` again. See `SECURITY_NOTES.md`.

Optional (stretch features, flagged off when unset): `TELEGRAM_BOT_TOKEN`, `AT_USERNAME`, `AT_API_KEY`.

## 5. Build and deploy

```bash
npm run build
npx wrangler deploy
```

Note the worker host it prints, for example `https://agrivoice.<your-subdomain>.workers.dev`. `DEMO_MODE` is `"0"` in `wrangler.toml`: in production the site shows a clear error rather than demo weather when Open-Meteo is unreachable (stale cache is used first).

## 6. Seed base data (states, crops, default alert rules)

```bash
npm run -s db:seed -- --sql > .local/seed.sql
npx wrangler d1 execute agrivoice --remote --file .local/seed.sql
```

LGAs for the pilot state (geocodes through Open-Meteo; add `--offline` to use the state point for every LGA):

```bash
npm run -s db:seed:locations -- Ogun --sql > .local/lgas.sql
npx wrangler d1 execute agrivoice --remote --file .local/lgas.sql
```

Another state needs its LGA names added to `scripts/data/lgas.json` first.

Do **not** run the demo seed in production unless you want visible placeholder content. For a demo deployment, sign in to `/admin`, open **Import/export**, and import `content-templates/markets.csv`, `briefs.csv`, `qa.csv` and `alert_advice.csv` (in that order, after crops and rules exist); placeholder flags are kept.

## 7. First admin steps

1. Open `https://<worker-host>/admin`, sign in.
2. **Agents:** create agent codes (shown once) and give them to village agents privately.
3. **Briefs, Q&A, Alert advice:** enter content written by an agronomist; set status approved with the reviewer's name. **Alert rules:** confirm thresholds with an agronomist, then clear *Needs review* with their name.
4. Read `/privacy` and have a qualified person review it before real farmers use the service. Replace the bracketed contact placeholders in `apps/web/src/pages/privacy.astro`, rebuild and redeploy.

## 8. Connect the Africa's Talking sandbox

1. Create an Africa's Talking account and open the **Sandbox** app.
2. Under **USSD**, create a channel (sandbox code). Set the callback URL to:

   ```
   https://<worker-host>/api/ussd/at/<USSD_PATH_TOKEN>
   ```

3. Open the sandbox **Simulator**, enter a test phone number, dial the channel code, and walk through setup, brief, weather, prices, ask and settings.
4. The callback sends `sessionId, serviceCode, phoneNumber, text, networkCode` as form data and expects text starting `CON ` or `END `. If the sandbox shows nothing, check the worker logs (`npx wrangler tail`) and that the token in the URL matches exactly.

A live short code needs a licence and funding and is out of scope for the challenge.

## 9. Retention job

`wrangler.toml` schedules a daily job (03:17 UTC) that deletes USSD sessions and rate-limit rows older than 1 day and clears call-back numbers older than 30 days. To run it by hand:

```bash
npx wrangler d1 execute agrivoice --remote --command "DELETE FROM ussd_sessions WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'); DELETE FROM rate_limits WHERE window_start < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'); UPDATE questions SET contact = NULL WHERE contact IS NOT NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 day');"
```

## Smoke tests after deploy

- [ ] `https://<worker-host>/api/health` returns `{"ok":true}`.
- [ ] `/` loads fast and shows the attribution footer; response headers include `Content-Security-Policy`.
- [ ] `/api/places` lists 37 states; `/api/places?state=Ogun` lists LGAs.
- [ ] `/api/forecast?locationId=<id>` returns 7 days from `open-meteo` (not an error).
- [ ] `/demo` runs a full first-time USSD session.
- [ ] `/admin` shows the login form; a wrong password is refused; the right one opens the dashboard.
- [ ] Create an agent, submit a price on `/prices/report`, approve it in the admin, see it on `/prices`.
- [ ] Ask a nonsense question on `/ask`, see it in the admin queue, answer it.
- [ ] Africa's Talking sandbox simulator shows the first screen (`CON Select state:`).
- [ ] Dial through Settings, Delete my data; `/api/stats/public` registered farmers drops by one.
- [ ] Dashboard banner shows how many placeholder items remain; nothing marked "Demo data" if you intend a real launch.

## Rollback

- **Code:** `npx wrangler rollback` (choose the previous version), or check out the previous git tag and `npm run build && npx wrangler deploy`.
- **Database:** D1 keeps point-in-time history: `npx wrangler d1 time-travel info agrivoice` then `npx wrangler d1 time-travel restore agrivoice --timestamp=<ISO time>`. Migrations are append-only; add a new `000N_*.sql` to change schema.
- **Secrets:** rotate with `npx wrangler secret put <NAME>`. Rotating `SESSION_SECRET` signs out every admin session. Do not rotate `PHONE_HASH_SECRET` or `REPORTER_PEPPER` unless you accept re-registration and re-issuing agent codes.
- **Bad content:** set the item to draft or archived in the admin; it disappears from farmers immediately.
