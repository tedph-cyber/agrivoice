import { expect, test } from '@playwright/test';

const PAGES = ['/', '/demo/', '/brief/', '/prices/', '/prices/report/', '/ask/', '/privacy/', '/admin/'];

for (const path of PAGES) {
  test(`page weight, CSP and console are clean: ${path}`, async ({ page }) => {
    let bytes = 0;
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', async (r) => {
      if (/\.(mp3|m4a)$/.test(r.url())) return;
      try { bytes += (await r.body()).length; } catch { /* redirects have no body */ }
    });
    const res = await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(res!.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(res!.headers()['x-frame-options']).toBe('DENY');
    expect(bytes, `${path} transferred ${bytes} bytes (uncompressed)`).toBeLessThan(100 * 1024);
    expect(errors.filter((e) => !/status of 401/.test(e))).toEqual([]);
    // no inline scripts anywhere
    expect(await page.locator('script:not([src])').count()).toBe(0);
  });
}
