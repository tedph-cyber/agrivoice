import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 8799);
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, trace: 'off', screenshot: 'off' },
  webServer: {
    command: 'npx tsx scripts/e2e-server.ts',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
