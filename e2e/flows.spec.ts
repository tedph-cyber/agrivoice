import { expect, test } from '@playwright/test';
import { adminUiLogin, dial, pick, register, send } from './helpers';

test('flow 1: simulator first-time setup, menu, brief, weather, prices, ask', async ({ page }) => {
  const menu = await register(page, '+2348000000101');
  for (const k of ['1 Farm brief', '2 Weather and alerts', '3 Market prices', '4 Ask a question', '5 My settings']) expect(menu).toContain(k);
  expect(await send(page, '1')).toContain('DEMO:');
  await send(page, '0');
  const weather = await send(page, '2');
  expect(weather).toMatch(/Heavy rain forecast for Abeokuta North/);
  expect(weather).toContain('(unconfirmed)');
  expect(weather).toMatch(/Updated \d\d:\d\d/);
  await send(page, '0');
  expect(await send(page, '3')).toContain('Prices for:');
  const prices = await pick(page, 'Maize');
  expect(prices).toContain('DEMO:');
  expect(prices).toMatch(/PLACEHOLDER Ma/);
  await send(page, '00');
  const ask = await send(page, '4');
  expect(ask).toContain('Questions:');
  const ans = await send(page, '1');
  expect(ans).toContain('DEMO:');
  await send(page, '0');
  const cb = await send(page, '6');
  expect(cb).toContain('Topic for call-back');
  await send(page, '1');
  const done = await send(page, '2');
  expect(done).toContain('cannot call you back');
  await expect(page.locator('#sim-screen')).toContainText('[Session ended]');
  // restart works
  await page.locator('#sim-restart').click();
  await expect(page.locator('#sim-screen')).toHaveText('Press Dial to start.');
});

test('flow 2: agent submits a price, admin approves, it shows on /prices and in USSD', async ({ page, browser }) => {
  const admin = await browser.newPage();
  await adminUiLogin(admin);
  await admin.getByRole('button', { name: 'Agents' }).click();
  await admin.locator('#rname').fill('E2E Agent');
  await admin.getByRole('button', { name: 'Create code' }).click();
  const shown = await admin.locator('.msg.ok').filter({ hasText: 'Code for' }).innerText();
  const code = /: ([A-Z2-9]{8})\./.exec(shown)![1]!;

  await page.goto('/prices/report/');
  await page.locator('#code').fill(code);
  await page.locator('#market').selectOption({ index: 1 });
  await page.locator('#crop').selectOption({ label: 'Maize' });
  await page.locator('#price').fill('55555');
  await page.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.locator('#out')).toContainText('sent for approval');

  await page.goto('/prices/');
  await expect(page.locator('#out table')).toBeVisible();
  await expect(page.locator('#out')).not.toContainText('55,555');

  await admin.getByRole('button', { name: 'Prices', exact: true }).click();
  await expect(admin.locator('table')).toContainText('55555');
  await admin.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await expect(admin.getByText('Nothing pending.')).toBeVisible();

  await page.goto('/prices/');
  await expect(page.locator('#out')).toContainText('N55,555 per bag');
  await expect(page.locator('#out')).toContainText('today');

  await register(page, '+2348000000102');
  await send(page, '3');
  expect(await pick(page, 'Maize')).toContain('N55555/bag (today)');
  await admin.close();
});

test('flow 3: question with no match is sent, appears in admin queue, admin answers', async ({ page, browser }) => {
  await page.goto('/ask/');
  await page.locator('#q').fill('zzqxv unrelated gibberish');
  await page.getByRole('button', { name: 'Search answers' }).click();
  await expect(page.getByText('No matching answer found.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Send your question to an agent' })).toBeVisible();
  await page.locator('#qtext').fill('Why are my cassava leaves curling? zzqxv');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.locator('#sent')).toContainText('sent to an agent');

  const admin = await browser.newPage();
  await adminUiLogin(admin);
  await admin.getByRole('button', { name: 'Questions' }).click();
  const card = admin.locator('.card', { hasText: 'cassava leaves curling' });
  await expect(card).toContainText('contact: none');
  await card.locator('textarea').fill('An extension agent will visit.');
  await card.getByRole('button', { name: 'Send answer' }).click();
  await expect(card).toHaveCount(0);
  await admin.close();
});

test('flow 3b: a matching question shows the approved answer', async ({ page }) => {
  await page.goto('/ask/');
  await page.locator('#q').fill('example placeholder');
  await page.getByRole('button', { name: 'Search answers' }).click();
  await expect(page.locator('#results article').first()).toBeVisible();
  await expect(page.locator('#results .badge').first()).toHaveText('Demo data');
});

test('flow 4: /admin is inaccessible without login; wrong password rejected and rate limited', async ({ browser, request }) => {
  expect((await request.get('/api/admin/prices')).status()).toBe(401);
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '203.0.113.77' } });
  const page = await ctx.newPage();
  await page.goto('/admin/');
  await expect(page.locator('#loginform')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  for (let i = 0; i < 5; i++) {
    await page.locator('#pw').fill('wrong-password-' + i);
    const [r] = await Promise.all([page.waitForResponse('**/api/admin/login'), page.getByRole('button', { name: 'Sign in' }).click()]);
    expect(r.status()).toBe(401);
    await expect(page.locator('#err')).toContainText('Wrong password');
  }
  await page.locator('#pw').fill('e2e-admin-password');
  const [r6] = await Promise.all([page.waitForResponse('**/api/admin/login'), page.getByRole('button', { name: 'Sign in' }).click()]);
  expect(r6.status()).toBe(429);
  await expect(page.locator('#err')).toContainText('Too many failed attempts');
  await expect(page.locator('#app')).toBeHidden();
  await ctx.close();
});

test('flow 5: deleting through USSD removes the farmer record', async ({ page, request }) => {
  const count = async () => (await (await request.get('/api/stats/public')).json()).registeredFarmers as number;
  const before = await count();
  await register(page, '+2348000000105');
  expect(await count()).toBe(before + 1);
  expect(await send(page, '5')).toContain('Settings');
  expect(await send(page, '3')).toContain('Delete your saved place and crop?');
  const done = await send(page, '1');
  expect(done).toContain('deleted');
  expect(done).toContain('30 days');
  expect(await count()).toBe(before);
  // dialing again starts first-time setup
  expect(await dial(page, '+2348000000105')).toContain('Select state');
});

test('brief page shows forecast, alert, brief, prices with demo badges', async ({ page }) => {
  await page.goto('/brief/');
  await page.locator('#state').selectOption('Ogun');
  await page.locator('#lga').selectOption({ label: 'Abeokuta North' });
  await page.locator('#crop').selectOption({ label: 'Maize' });
  await expect(page.getByRole('heading', { name: 'Weather alerts' })).toBeVisible();
  await expect(page.locator('.alert').first()).toContainText('Heavy rain forecast for Abeokuta North');
  await expect(page.locator('.alert .badge.warn').first()).toHaveText('Unconfirmed threshold');
  await expect(page.locator('#out table').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'PLACEHOLDER brief' })).toBeVisible();
  await expect(page.locator('#out .badge', { hasText: 'Demo data' }).first()).toBeVisible();
  await expect(page.getByText('Weather data by Open-Meteo.com').first()).toBeVisible();
});

test('P1: web deletion request is handled in the admin', async ({ page, browser }) => {
  await page.goto('/privacy/');
  await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
  await page.locator('#note').fill('Please delete my profile e2e-delete-note');
  await page.getByRole('button', { name: 'Send deletion request' }).click();
  await expect(page.locator('#out')).toContainText('Request received');
  const admin = await browser.newPage();
  await adminUiLogin(admin);
  await admin.getByRole('button', { name: 'Deletions' }).click();
  const row = admin.locator('tr', { hasText: 'e2e-delete-note' });
  await expect(row).toContainText('open');
  await row.getByRole('button', { name: 'Mark done' }).click();
  await expect(admin.locator('tr', { hasText: 'e2e-delete-note' })).toContainText('done');
  await admin.close();
});

test('P1: admin CSV import with row errors, then stats page', async ({ browser }) => {
  const admin = await browser.newPage();
  await adminUiLogin(admin);
  await admin.getByRole('button', { name: 'Import/export' }).click();
  await admin.locator('#imptype').selectOption('markets');
  await admin.locator('#impmode').selectOption('skip-invalid');
  await admin.locator('#impfile').setInputFiles({ name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from('name,state,lga,lat,lon,is_placeholder\nE2E Market,Ogun,,,,0\n,Ogun,,,,0\n') });
  await admin.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(admin.locator('.msg.ok')).toContainText('Imported 1 row(s), skipped 1');
  await expect(admin.locator('td', { hasText: 'name is required' })).toBeVisible();
  await admin.getByRole('button', { name: 'Stats' }).click();
  await expect(admin.getByRole('heading', { name: 'Stats' })).toBeVisible();
  await expect(admin.getByText('Registered farmers:')).toBeVisible();
  await admin.close();
});

test('P1 security: stored XSS payloads render as text on public and admin pages', async ({ page, request, browser }) => {
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await request.post('/api/admin/login', { data: { password: 'e2e-admin-password' }, headers: { 'x-requested-with': 'e2e' } });
  const r = await request.post('/api/admin/markets', { data: { name: payload, state: 'Ogun' }, headers: { 'x-requested-with': 'e2e' } });
  expect(r.status()).toBe(201);
  let dialogs = 0;
  page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
  await page.goto('/prices/report/');
  await expect(page.locator('#market option', { hasText: '<img src=x' })).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  const admin = await browser.newPage();
  admin.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
  await adminUiLogin(admin);
  await admin.getByRole('button', { name: 'Markets' }).click();
  await expect(admin.locator('td', { hasText: '<img src=x' })).toBeVisible();
  expect(await admin.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await admin.locator('img[src="x"]').count()).toBe(0);
  expect(dialogs).toBe(0);
  await admin.close();
});
