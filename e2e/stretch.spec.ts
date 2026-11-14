import { expect, test } from '@playwright/test';

test('T24: /brief works offline from the saved copy and says so', async ({ page, context }) => {
  await page.goto('/brief/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.locator('#state').selectOption('Ogun');
  await page.locator('#crop').selectOption({ label: 'Maize' });
  await expect(page.getByRole('heading', { name: 'Recent prices' })).toBeVisible();
  await page.reload(); // now controlled by the service worker: the page and its API calls are cached
  await expect(page.getByRole('heading', { name: 'Recent prices' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Weather alerts' })).toBeVisible();
  await expect(page.locator('.alert').first()).toContainText('Heavy rain forecast');
  await expect(page.locator('#cached-banner')).toContainText('Showing saved data');
  await context.setOffline(false);
});

test('T24: the service worker never caches admin or USSD endpoints', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const sw = await page.request.get('/sw.js');
  const src = await sw.text();
  expect(src).toContain("p.startsWith('/api/admin')");
  expect(src).toContain("p.startsWith('/api/ussd')");
  expect(src).toContain("req.method !== 'GET'");
});

test('T25: Read aloud shows only when the browser has a matching voice', async ({ page }) => {
  await page.goto('/brief/');
  await page.locator('#state').selectOption('Ogun');
  await page.locator('#crop').selectOption({ label: 'Maize' });
  await expect(page.getByRole('heading', { name: 'PLACEHOLDER brief' })).toBeVisible();
  await expect(page.locator('#read-aloud')).toBeHidden(); // headless Chromium has no voices
});

test('T25: Read aloud speaks the brief when a voice exists', async ({ page }) => {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    class U { text: string; lang = ''; onend: (() => void) | null = null; constructor(t: string) { this.text = t; } }
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = U;
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speaking: false, getVoices: () => [{ lang: 'en-GB' }], addEventListener: () => undefined, cancel: () => undefined, speak: (u: { text: string }) => { spoken.push(u.text); } },
    });
  });
  await page.goto('/brief/');
  await page.locator('#state').selectOption('Ogun');
  await page.locator('#crop').selectOption({ label: 'Maize' });
  await expect(page.locator('#read-aloud')).toBeVisible();
  await page.locator('#read-aloud').click();
  expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken[0])).toContain('PLACEHOLDER brief');
});
