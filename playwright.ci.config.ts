import { defineConfig } from '@playwright/test';
import local from './playwright.config';

export default defineConfig({
  ...local,
  use: { ...local.use, channel: 'chromium' },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1',
    // The app root requires a sign-in cookie; readiness probes do not retain it.
    url: 'http://127.0.0.1:5173/favicon.svg',
    reuseExistingServer: false,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
