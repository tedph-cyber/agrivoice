import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
  vite: { build: { assetsInlineLimit: 0 } },
  telemetry: false,
});
