import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { adminUiLogin } from './helpers';

async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')})`);
  expect(summary, `${label} accessibility violations`).toEqual([]);
}

for (const path of ['/', '/demo/', '/brief/', '/prices/', '/prices/report/', '/ask/', '/privacy/', '/admin/']) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await audit(page, path);
  });
}

test('axe: brief with data, ask with no-match form, demo with a screen, admin tabs', async ({ page }) => {
  await page.goto('/brief/');
  await page.locator('#state').selectOption('Ogun');
  await page.locator('#crop').selectOption({ label: 'Maize' });
  await expect(page.getByRole('heading', { name: 'Recent prices' })).toBeVisible();
  await audit(page, 'brief with data');

  await page.goto('/ask/');
  await page.locator('#q').fill('zzqxv gibberish');
  await page.getByRole('button', { name: 'Search answers' }).click();
  await expect(page.locator('#send')).toBeVisible();
  await audit(page, 'ask no match');

  await page.goto('/demo/');
  await page.locator('#sim-dial').click();
  await expect(page.locator('#sim-screen')).toContainText('Select state');
  await audit(page, 'demo running');

  await adminUiLogin(page);
  for (const tab of ['Dashboard', 'Prices', 'Briefs', 'Q&A', 'Alert rules', 'Agents', 'Questions', 'Import/export', 'Stats']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForLoadState('networkidle');
    await audit(page, `admin ${tab}`);
  }
});

test('keyboard: skip link, tab order reaches the main controls, visible focus', async ({ page }) => {
  await page.goto('/ask/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.locator('#q').focus();
  const outline = await page.locator('#q').evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  // simulator works with the keyboard only
  await page.goto('/demo/');
  await page.locator('#sim-dial').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sim-screen')).toContainText('Select state');
  await page.locator('#sim-input').focus();
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sim-screen')).toContainText('Bayelsa');
});

test('no layout shift on the brief page after data loads', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/brief/');
  await page.locator('#state').selectOption('Ogun');
  await page.locator('#crop').selectOption({ label: 'Maize' });
  await expect(page.getByRole('heading', { name: 'Recent prices' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.1);
});
