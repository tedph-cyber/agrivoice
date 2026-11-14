# User guide

## Farmer with a basic phone (USSD)

Dial the service code (during the challenge: the Africa's Talking sandbox, or the simulator at `/demo`).

1. **First time:** choose your state, your LGA and your crop. You are asked: *Save your place and crop? We keep a scrambled code, not your number.* Reply `1` to save, `2` to use it just this once.
2. **Main menu:** `1` Farm brief, `2` Weather and alerts, `3` Market prices, `4` Ask a question, `5` My settings.
3. **Farm brief:** a short summary for your crop this week. Long text has `1 Next` and `0 Back`.
4. **Weather and alerts:** a warning first if one applies, then tomorrow and the next two days (rain in mm, lowest and highest temperature). Alerts marked *(unconfirmed)* use thresholds an agronomist has not confirmed yet. *(old data)* means the forecast could not be refreshed.
5. **Market prices:** pick a crop and see up to three markets with price and age.
6. **Ask a question:** pick one of the listed questions to read the answer. If none fits, `6 None of these` asks for a topic and whether we may keep your number for a call-back. Say `2` and no number is kept.
7. **My settings:** change language, change place and crop, or **Delete my data** (asks to confirm). Call-back requests are removed within 30 days.

Keys: `0` goes back, `00` goes to the main menu. A session ends after 5 minutes of silence.

Anything marked `DEMO:` is placeholder content, not real advice or prices.

## Farmer or extension agent with a smartphone

- `/brief`: pick state, LGA and crop for the forecast table, alerts, the approved brief (with a voice note if there is one) and recent prices.
- `/prices`: price board by crop and state with report age.
- `/ask`: type a question to find approved answers. If nothing matches you can send it to an agent; a phone number is kept only if you tick the consent box.
- `/privacy`: what we keep and how to ask for deletion.
- The language box in the top bar switches language where translations exist; missing text falls back to English.

## Village price agent

1. The admin gives you an 8-character code once. Keep it private.
2. Open `/prices/report`, enter your code, market, crop, unit (bag, basket, kg) and the price in naira, then **Send for approval**.
3. An admin checks it. Approved prices appear on `/prices` and in the USSD menu.

If you get "code not recognised", check for look-alike characters; codes use no `0`, `1`, `I`, `L` or `O`. Too many reports in an hour are refused.

## Admin (`/admin`)

Sign in with the admin password. Tabs:

- **Dashboard:** counts of placeholder items still present, pending prices, open questions and deletion requests.
- **Prices:** approve or reject, or approve all.
- **Briefs, Q&A, Alert advice:** create and edit. To publish, set status *approved* and type the reviewer's name; the approval date is filled in. Without both, nothing is shown to farmers. Keep the USSD summary to 140 characters.
- **Alert rules:** edit thresholds. Untick *Needs review* only after an agronomist confirmed the value, and type their name in the reviewer box.
- **Markets, Crops, Agents:** create an agent code (shown once; only a hash is stored); deactivate agents who leave.
- **Questions:** answer web questions and read call-back requests. Numbers kept for call-backs disappear after 30 days.
- **Deletions:** handle web deletion requests, then mark done.
- **Import/export:** CSV in the formats of `content-templates/`. *All or nothing* imports nothing if any row is wrong; *Skip invalid rows* imports the good ones and lists the rest. Rows keep their `is_placeholder` flag.
- **Stats:** registrations, sessions by day and channel, prices, questions.

Audio: copy an MP3 or M4A into `apps/web/public/audio/`, rebuild and deploy, then set the brief's audio URL to `/audio/<file>`.
