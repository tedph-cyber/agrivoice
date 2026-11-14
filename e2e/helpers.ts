import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const ADMIN_PASSWORD = 'e2e-admin-password';
const H = { 'x-requested-with': 'e2e' };

export async function screenText(page: Page): Promise<string> {
  return (await page.locator('#sim-screen').innerText()).trim();
}

/** Press a digit string into the simulator and send. */
export async function send(page: Page, value: string): Promise<string> {
  const input = page.locator('#sim-input');
  await input.fill(value);
  await page.locator('#sim-send').click();
  await expect(input).toHaveValue('');
  // wait for the screen to settle on new content
  await page.waitForTimeout(150);
  return screenText(page);
}

/** On a numbered list screen, choose the entry with this label, paging with 7 when needed. */
export async function pick(page: Page, label: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const text = await screenText(page);
    const m = new RegExp(`^(\\d) ${label}\\s*$`, 'm').exec(text);
    if (m) return send(page, m[1]!);
    if (!/^7 More/m.test(text)) throw new Error(`"${label}" not found on screen:\n${text}`);
    await send(page, '7');
  }
  throw new Error(`"${label}" not found`);
}

export async function dial(page: Page, phone: string): Promise<string> {
  await page.goto('/demo/');
  await page.locator('#sim-phone').fill(phone);
  await page.locator('#sim-dial').click();
  await expect(page.locator('#sim-screen')).not.toHaveText('Press Dial to start.');
  return screenText(page);
}

/** First-time setup as a new farmer; returns the main menu screen. */
export async function register(page: Page, phone: string, consent: '1' | '2' = '1'): Promise<string> {
  await dial(page, phone);
  await pick(page, 'Ogun');
  await pick(page, 'Abeokuta North');
  await pick(page, 'Maize');
  const c = await screenText(page);
  expect(c).toContain('Save your place and crop?');
  return send(page, consent);
}

export async function adminLogin(request: APIRequestContext): Promise<void> {
  const r = await request.post('/api/admin/login', { data: { password: ADMIN_PASSWORD }, headers: H });
  expect(r.status()).toBe(200);
}

export async function adminUiLogin(page: Page): Promise<void> {
  await page.goto('/admin/');
  await page.locator('#pw').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
