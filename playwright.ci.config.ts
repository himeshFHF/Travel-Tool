import { defineConfig } from '@playwright/test';
import local from './playwright.config';

export default defineConfig({
  ...local,
  use: { ...local.use, channel: 'chromium' },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
