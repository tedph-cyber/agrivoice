# AgriVoice: operating manual for the coding agent

You are the only developer on this repository. The owner, Ted, is not watching and will not answer questions during the run. Work autonomously until every task in `TASKS.md` is done or recorded as blocked. Do not ask for approval or confirmation. Make the sensible choice, record it in `DECISIONS.md`, and keep going.

## Goal

Build the lean AgriVoice MVP described in `BUILD_SPEC.md` for the USPF Changemaker Challenge (Agriculture track). It gives smallholder farmers a weekly farm brief, weather alerts, market prices and answers to common questions through a USSD menu (basic phones, no data) and a light website. It must run at zero cost on free tiers. A working demo matters more than completeness: finish the P0 tasks first, tag the repository `demo-ready`, then continue.

## Read first, in this order

1. `BUILD_SPEC.md` (what to build)
2. `TASKS.md` (ordered work, with acceptance checks)
3. `NEEDS_FROM_TED.md` (inputs Ted will supply, and defaults when he has not)
4. This file

## Operating loop (repeat until done)

1. Open `TASKS.md`. Pick the first unchecked task whose dependencies are done.
2. Implement it to its acceptance criteria. Write the tests with it, not after.
3. Run `npm run check` (lint, typecheck, unit tests). Fix until green. Run `npm run e2e` for tasks that touch user flows.
4. Commit with a clear message such as `T07: add admin API for price moderation`. Tick the box in `TASKS.md`. Append one line to `PROGRESS.md`: date, task, what changed, how it was verified.
5. Start the next task at once. Do not stop to summarise between tasks.

If a task still fails verification after 3 genuine attempts, write it to `BLOCKERS.md` (what failed, what you tried, what is needed), leave it unticked with the word "(blocked)", and move on.

## Resuming

All state lives in files. If you are started again, read `TASKS.md`, `PROGRESS.md`, `BLOCKERS.md` and `git log`, then continue from the first unchecked task. Do not redo ticked tasks unless their tests fail.

## Decision policy

- When the spec is ambiguous, choose the simplest option consistent with `BUILD_SPEC.md`. Add one line to `DECISIONS.md`: date, question, choice, reason.
- Do not change requirements in `BUILD_SPEC.md`. You may add clarifications in a "Clarifications" section at the end.
- Prefer boring, well-known libraries. Add a dependency only when it saves real work, and note it in `DECISIONS.md`.
- Free-tier only. If a feature needs a paid service, build the adapter with a mock implementation and mark the feature as flagged off.

## The only reasons to stop and wait

All tasks are done, or every remaining task is blocked. Nothing else.

## Hard rules (never break these)

- Never spend money, create paid plans, or add paid-only dependencies.
- Never deploy or publish. Do not run `wrangler deploy`, `wrangler secret`, `wrangler login`, or `git push`. Do not use `--remote` with any wrangler command. Everything is local. Ted deploys using `DEPLOY.md`.
- Never put secrets, tokens, real phone numbers or real farmer data in the repository, tests, logs or fixtures. Local secrets go in `.dev.vars` (git-ignored); keep `.dev.vars.example` current. `npm run setup:local` generates random local values.
- Never invent agronomic advice, prices, thresholds or statistics. All advice shown to farmers comes from database content that has a reviewer and an approval date. Where real content is missing, use clearly flagged placeholder content (`is_placeholder = 1`), which every interface labels "Demo data". Never present placeholder data as real.
- Never write or "improve" farm advice text yourself in code, tests that look like real guidance, or seed files other than the flagged placeholders in `content-templates/`.
- Keep every outside service (Africa's Talking, Telegram, SMS) behind an adapter interface. The mock adapter is the default.
- Never delete or modify files outside this repository. Never run destructive commands (`rm -rf` outside build output, `git reset --hard`, force push).
- Log no phone numbers. Mask all but the last 2 digits in any log line.

## Missing inputs

If something from `NEEDS_FROM_TED.md` is absent, use the stated default or the mock adapter, add a line to `BLOCKERS.md` under "Waiting on Ted", and continue.

## Engineering standards

- TypeScript with `strict` on. No `any` without a comment explaining why.
- Validate every input at the boundary with `zod`. Use parameterised SQL only.
- Pure logic (USSD engine, alert rules, scoring, text truncation) lives in `packages/core` with no I/O, so it is easy to test.
- Tests: Vitest for unit and API tests. Playwright for the P0 end-to-end flows.
- USSD screens must be 182 characters or fewer including the `CON ` or `END ` prefix, and use only GSM 7-bit characters (write `N` for naira, not the naira symbol). Assert this in tests for every screen and language.
- Public pages must stay light: under 100 KB transferred excluding audio, no front-end framework runtime on public pages, system fonts, works on slow connections.
- Accessibility: semantic HTML, labelled form fields, AA contrast, visible focus.
- Dates in the database are ISO 8601 UTC. Display in `Africa/Lagos`.
- Show "Demo data" badges wherever placeholder content appears, and a banner in the admin counting placeholders still present.

## Commands (create them in T00 and keep them working)

| Command | Does |
| --- | --- |
| `npm run setup:local` | Generates `.dev.vars` with random local secrets |
| `npm run dev` | Runs API and web locally |
| `npm run check` | Lint, typecheck, unit and API tests |
| `npm run e2e` | Playwright end-to-end tests |
| `npm run db:migrate` | Applies migrations to the local database |
| `npm run db:seed` | Seeds base data (states, crops, default alert rules) |
| `npm run db:seed:demo` | Adds flagged demo content |
| `npm run admin:hash -- <password>` | Prints an admin password hash for `ADMIN_PASSWORD_HASH` |
| `npm run purge` | Applies retention rules |

## Definition of done for a task

Acceptance criteria met, tests written and passing, `npm run check` green, committed, box ticked, `PROGRESS.md` updated, no new blockers left unrecorded.

## At the end

Write `HANDOVER.md`: what is built, how to run it, how to deploy (point to `DEPLOY.md`), what is flagged off, what is blocked, what Ted must supply, and known risks. Tag `v0.1`.
