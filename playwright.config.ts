import { defineConfig, chromium } from "@playwright/test";
import { mkdtempSync, existsSync } from "node:fs";
const testData = mkdtempSync("/tmp/wayfarer-browser-");
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3123",
    headless: true,
    actionTimeout: 10000,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium")
          ? "/usr/bin/chromium"
          : chromium.executablePath()),
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `DATA_DIR=${testData} PORT=3123 NODE_ENV=production npm start`,
    url: "http://127.0.0.1:3123/api/auth",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
