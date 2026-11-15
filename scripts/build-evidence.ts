// Builds docs/AgriVoice-supporting-evidence.pdf from real screenshots of the running app (demo data, offline weather fixture).
// Run: npm run build:evidence   (needs `npm run build -w apps/web` first and Playwright's Chromium)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const root = join(import.meta.dirname, '..');
const PORT = 8801;
const base = `http://localhost:${PORT}`;
const server = spawn('npx', ['tsx', 'scripts/e2e-server.ts'], { cwd: root, env: { ...process.env, E2E_PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 1000));
}

const shots: Record<string, string> = {};
const browser = await chromium.launch();
const b64 = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;

async function sim(page: Page, input: string) {
  await page.locator('#sim-input').fill(input);
  await page.locator('#sim-send').click();
  await page.waitForTimeout(250);
}
async function pick(page: Page, label: string) {
  for (let i = 0; i < 10; i++) {
    const t = await page.locator('#sim-screen').innerText();
    const m = new RegExp(`^(\\d) ${label}\\s*$`, 'm').exec(t);
    if (m) return sim(page, m[1]!);
    await sim(page, '7');
  }
}
const phoneShot = async (page: Page, key: string) => { shots[key] = b64(await page.locator('.phone').screenshot()); };

try {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 2 });
  const p = await mobile.newPage();
  await p.goto(`${base}/demo/`);
  await p.locator('#sim-phone').fill('+2348000000001');
  await p.locator('#sim-dial').click();
  await p.waitForTimeout(400);
  await phoneShot(p, 'sim_state');
  await pick(p, 'Ogun'); await pick(p, 'Abeokuta North'); await pick(p, 'Maize');
  await phoneShot(p, 'sim_consent');
  await sim(p, '1'); await phoneShot(p, 'sim_menu');
  await sim(p, '1'); await phoneShot(p, 'sim_brief');
  await sim(p, '0'); await sim(p, '2'); await phoneShot(p, 'sim_weather');
  await sim(p, '0'); await sim(p, '3'); await pick(p, 'Maize'); await phoneShot(p, 'sim_prices');

  const grab = async (path: string, key: string, setup?: (pg: Page) => Promise<void>, height = 1500) => {
    const pg = await mobile.newPage();
    await pg.goto(`${base}${path}`);
    if (setup) await setup(pg);
    await pg.waitForTimeout(600);
    shots[key] = b64(await pg.screenshot({ clip: { x: 0, y: 0, width: 390, height } }));
    await pg.close();
  };
  await grab('/brief/', 'web_brief', async (pg) => { await pg.locator('#state').selectOption('Ogun'); await pg.locator('#lga').selectOption({ label: 'Abeokuta North' }); await pg.locator('#crop').selectOption({ label: 'Maize' }); await pg.waitForSelector('text=Recent prices'); }, 1700);
  await grab('/prices/', 'web_prices', undefined, 900);
  await grab('/ask/', 'web_ask', async (pg) => { await pg.locator('#q').fill('example placeholder'); await pg.getByRole('button', { name: 'Search answers' }).click(); await pg.waitForSelector('#results article'); }, 900);
  await grab('/prices/report/', 'web_report', undefined, 900);

  const desk = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1.5 });
  const a = await desk.newPage();
  await a.goto(`${base}/admin/`);
  await a.locator('#pw').fill('e2e-admin-password');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForSelector('text=placeholder items remain');
  shots.admin_dash = b64(await a.screenshot({ clip: { x: 0, y: 0, width: 1100, height: 520 } }));
  await a.getByRole('button', { name: 'Briefs' }).click();
  await a.waitForSelector('table');
  shots.admin_briefs = b64(await a.screenshot({ clip: { x: 0, y: 0, width: 1100, height: 520 } }));
} finally {
  await browser.close();
  server.kill();
}

const fig = (k: string, cap: string, w = 205) => `<figure><img src="${shots[k]}" width="${w}" alt="${cap}"/><figcaption>${cap}</figcaption></figure>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>AgriVoice supporting evidence</title><style>
@page { size: A4; margin: 16mm 14mm; }
body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.45; }
h1 { color: #1b5e20; font-size: 26pt; margin: 0 0 4px; } h2 { color: #1b5e20; border-bottom: 2px solid #1b5e20; padding-bottom: 3px; margin-top: 22px; font-size: 14pt; } h3 { font-size: 11pt; margin: 10px 0 4px; }
.sub { color: #444; font-size: 12pt; margin-bottom: 14px; } .row { display: flex; gap: 14px; flex-wrap: nowrap; align-items: flex-start; justify-content: center; break-inside: avoid; }
figure { margin: 0 0 10px; break-inside: avoid; text-align: center; } figure img { border: 1px solid #bbb; border-radius: 6px; } figcaption { font-size: 8.5pt; color: #444; margin: 3px auto 0; max-width: 340px; }
.row figure figcaption { font-size: 8pt; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; } th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; } th { background: #eef4ee; }
.box { border: 1px solid #1b5e20; background: #f3f8f3; padding: 6px 10px; border-radius: 6px; margin: 8px 0; }
.flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 8px 0; } .node { border: 1px solid #1b5e20; border-radius: 6px; padding: 5px 8px; background: #f3f8f3; font-size: 9pt; text-align: center; } .arrow { color: #1b5e20; font-weight: bold; }
.pb { page-break-before: always; } .small { font-size: 9pt; color: #444; }
</style></head><body>
<h1>AgriVoice</h1>
<div class="sub">Weekly farm brief, weather alerts, market prices and answers for Nigerian smallholder farmers, by USSD and web.<br/>Supporting evidence for the USPF Changemaker Challenge 2026, Agriculture sector. Team AgriNova: Israel Olanrewaju and Theophilus Oyekola.</div>
<div class="box"><b>Status in one line:</b> a working, deployed prototype with demo content. It has not yet been tested with real farmers, and all briefs, answers and prices shown in the screenshots are placeholders labelled "Demo data". Weather in these screenshots comes from an offline demo forecast.</div>

<h2>1. What it does</h2>
<table><tr><th>Channel</th><th>For whom</th><th>What they get</th></tr>
<tr><td>USSD menu</td><td>Farmers on basic phones, no data needed</td><td>Farm brief, weather and alerts, market prices, ask a question (with call-back request), settings including delete-my-data</td></tr>
<tr><td>Website</td><td>Smartphone users, extension agents</td><td>Same information plus forecast table, voice notes, read-aloud, offline pages</td></tr>
<tr><td>Price form</td><td>Village price agents</td><td>Report market prices with a private code; reports are approved before they show</td></tr>
<tr><td>Admin console</td><td>Admin, agronomist reviewers</td><td>Approve prices, manage briefs, answers, alert advice and thresholds, answer questions, import and export CSV, stats</td></tr></table>

<h2 class="pb">2. USSD walkthrough (built-in simulator)</h2>
<p class="small">The simulator shows exactly what a farmer sees on a basic phone. Every screen is at most 182 characters and uses only the basic GSM character set.</p>
<div class="row">${fig('sim_state', '1. First dial: choose state (paged).')}${fig('sim_consent', '2. After state, LGA and crop: plain-language consent.')}${fig('sim_menu', '3. Main menu.')}</div>
<div class="row">${fig('sim_brief', '4. Farm brief. DEMO: marks placeholder content.')}${fig('sim_weather', '5. Weather and alert, marked as unconfirmed.')}${fig('sim_prices', '6. Market prices with report age.')}</div>

<h2 class="pb">3. Website (phone view)</h2>
<div class="row">${fig('web_brief', 'Farm brief: alerts, 7-day forecast, approved brief, prices. Demo data badges.', 165)}${fig('web_prices', 'Price board by crop and state.', 165)}${fig('web_ask', 'Ask: searches approved answers only.', 165)}${fig('web_report', 'Price agents send prices with a private code for approval.', 165)}</div>

<h2>4. Admin console</h2>
<div class="row">${fig('admin_dash', 'Dashboard counts the placeholder items still present, pending prices and open questions.', 340)}${fig('admin_briefs', 'Briefs: publishing needs a reviewer name; approval date is recorded.', 340)}</div>

<h2>5. Safeguards built in</h2>
<table><tr><th>Concern</th><th>How it is handled</th></tr>
<tr><td>Wrong advice</td><td>No AI-generated advice. A brief, answer or alert advice is shown only if status is approved and a reviewer name and approval date exist. Weather alerts from unconfirmed thresholds say "Unconfirmed threshold".</td></tr>
<tr><td>Demo vs real</td><td>Placeholders are flagged and labelled "Demo data" on every interface and "DEMO:" on USSD. The admin dashboard counts them.</td></tr>
<tr><td>Phone privacy</td><td>Phone numbers are stored only as a keyed hash, and only with consent. A raw number for a call-back needs explicit consent and is deleted after 30 days. Farmers can delete their data from the phone menu.</td></tr>
<tr><td>Security</td><td>Hashed admin password (PBKDF2), signed session cookie, CSRF header, rate limits, strict content-security policy, parameterised SQL, secrets kept out of the repository.</td></tr>
<tr><td>Price quality</td><td>Prices come from agents with private codes and are approved by an admin before they appear.</td></tr></table>

<h2>6. Technology</h2>
<div class="flow"><div class="node">Basic phone<br/>(USSD)</div><span class="arrow">→</span><div class="node">Africa's Talking</div><span class="arrow">→</span><div class="node"><b>Cloudflare Worker</b><br/>Hono API + static site</div><span class="arrow">→</span><div class="node">D1 database</div></div>
<div class="flow"><div class="node">Smartphone / agent / admin<br/>(browser)</div><span class="arrow">→</span><div class="node"><b>Cloudflare Worker</b></div><span class="arrow">→</span><div class="node">Open-Meteo forecast<br/>(cached 3 hours)</div></div>
<p class="small">TypeScript monorepo: <b>apps/api</b> (Hono), <b>apps/web</b> (Astro, no front-end framework runtime, pages under 100 KB), <b>packages/core</b> (USSD engine, alert rules, translations, Q&A scoring). Free tiers only. Optional, switched off: Telegram alerts, SMS adapter.</p>

<h2>7. Quality evidence</h2>
<table><tr><th>Check</th><th>Result</th></tr>
<tr><td>Unit and API tests (Vitest)</td><td>126 passing: USSD engine (every screen, back, home, paging, random-input test), alert thresholds at the boundaries, content-approval rules, price approval, rate limits, admin security, CSV import errors</td></tr>
<tr><td>End-to-end tests (Playwright)</td><td>33 passing: farmer setup through the simulator, agent price to admin approval to USSD, unanswered question to admin answer, admin login lockout, deletion through USSD, stored-script attack, offline mode</td></tr>
<tr><td>Accessibility</td><td>Automated WCAG 2 A/AA checks on every page and admin tab; keyboard navigation; layout shift below 0.1</td></tr>
<tr><td>Performance</td><td>Every public page under 100 KB, no inline scripts</td></tr></table>

<h2>8. What is not done yet</h2>
<ul><li>Real content from agronomists with reviewer names; confirmation of alert thresholds.</li><li>Testing with real farmers and price agents; testing on the Africa's Talking sandbox.</li><li>Nigerian-language translations (the language switch and fallback exist).</li><li>Live short code (needs funding and licensing); independent privacy review under the NDPA.</li></ul>

<h2>9. Contact</h2>
<p>Team AgriNova: Israel Olanrewaju and Theophilus Oyekola<br/>Email: oluwaolapelumi@gmail.com &nbsp; Phone: 08088585887<br/>Source code: github.com/tedph-cyber/agrivoice</p>
</body></html>`;


const b2 = await chromium.launch();
const pg = await b2.newPage();
await pg.setContent(html, { waitUntil: 'load' });
await pg.pdf({ path: join(root, 'docs', 'AgriVoice-supporting-evidence.pdf'), format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
await b2.close();
mkdirSync(join(root, 'docs'), { recursive: true });
console.log('Wrote docs/AgriVoice-supporting-evidence.pdf');
