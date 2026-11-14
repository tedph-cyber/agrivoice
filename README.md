# AgriVoice

Farm brief, weather alerts, market prices and answers for Nigerian smallholder farmers, by USSD and a light website. See `BUILD_SPEC.md`.

## Quick start

```bash
npm ci
npm run setup:local      # writes .dev.vars with random local secrets; prints the local admin password once
npm run db:migrate && npm run db:seed && npm run db:seed:demo
npm run dev              # builds the site and serves http://localhost:8787
```

(Full README is completed in task T20.)
