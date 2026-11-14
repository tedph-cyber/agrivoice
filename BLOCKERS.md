# Blockers

## Waiting on Ted

All items in `NEEDS_FROM_TED.md` were left at their defaults (Ogun, maize/cassava/tomato, English only, placeholder content flagged "Demo data", placeholder alert thresholds flagged `needs_review`, text-only briefs, simulator only for USSD, local-only secrets). Team name and contact details are bracketed placeholders.

- Real briefs, Q&A, alert advice (reviewed by an agronomist), markets, audio, confirmed alert thresholds.
- Review of the `/privacy` page by a qualified person.
- Cloudflare account, production secrets, Africa's Talking sandbox (see DEPLOY.md when written).

## Verify at deploy time (could not be checked from the build sandbox)

- Open-Meteo forecast and geocoding request/response format (network to open-meteo.com is blocked here).
- Africa's Talking USSD callback format.
- `wrangler dev` / workerd was not used locally; local runs use the Node server with a SQLite file.
