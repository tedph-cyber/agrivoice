# Inputs from Ted

Fill what you know. The agent uses the default for anything left blank, labels the result "Demo data", and lists the gap in `BLOCKERS.md` under "Waiting on Ted". None of this blocks the build.

## 1. Pilot and language

```
PILOT_STATE:        (default: Ogun)
PILOT_LGAS:         (default: all LGAs of the pilot state, geocoded)
CROPS:              (default: maize, cassava, tomato)
EXTRA_LANGUAGE:     (default: none; use a code: pcm, ha, yo, ig)
TEAM_NAME:          (default: [Team name])
CONTACT_EMAIL:      (default: [contact email])
CONTACT_PHONE:      (default: [contact phone])
```

## 2. Content (use the CSV templates in `content-templates/`)

| File | Needed from | Notes |
| --- | --- | --- |
| `briefs.csv` | Agronomist or extension officer | One brief per state, crop, language and week. Needs `reviewer` and `approved_at` before farmers see it |
| `qa.csv` | Agronomist | Common questions and answers per crop |
| `alert_advice.csv` | Agronomist | Optional advice per alert rule and crop |
| `alert_rules.csv` | Agronomist | Confirmed thresholds; clears `needs_review` |
| `markets.csv` | You or a co-op leader | Real markets in the pilot area |
| Audio files | A trusted voice | MP3 or M4A; put them in `apps/web/public/audio/` and set `audio_url` to `/audio/<file>` |

Rule: no advice goes live without a reviewer name and approval date. The agent never writes live advice.

## 3. Accounts and secrets (only at deploy; the agent never uses them)

| Item | Where it goes | How |
| --- | --- | --- |
| Cloudflare account (free) | Your machine | Create the account, then follow `DEPLOY.md` |
| Production secrets | Cloudflare Worker secrets | `openssl rand -hex 32` for each: `SESSION_SECRET`, `PHONE_HASH_SECRET`, `REPORTER_PEPPER`, `USSD_PATH_TOKEN`; `ADMIN_PASSWORD_HASH` from `npm run admin:hash` |
| Africa's Talking sandbox | Secrets `AT_USERNAME`, `AT_API_KEY` (only if SMS stretch is used) | Create a sandbox app and a USSD channel; callback URL in `DEPLOY.md` |
| Telegram bot token (stretch) | Secret `TELEGRAM_BOT_TOKEN` | Create with BotFather |

## 4. Reviews only a human can do

- Read the draft `/privacy` page and have a qualified person review it before real farmers use the service.
- Confirm alert thresholds with an agronomist.
- Watch the demo once and list anything to change in `TASKS.md` under a new heading "Ted's changes".

## 5. Defaults the agent will use if you provide nothing

Pilot state Ogun; crops maize, cassava, tomato; English only; placeholder markets, prices, briefs and answers flagged as demo; placeholder alert thresholds flagged `needs_review`; text-only briefs (no audio player); simulator only for USSD; local-only secrets.
