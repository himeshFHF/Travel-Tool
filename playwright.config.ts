import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", workers: 1, timeout: 120000,
  use: { baseURL: "http://127.0.0.1:5173", viewport: {width:1440,height:1000}, headless:true,
    screenshot:"only-on-failure",trace:"retain-on-failure", channel:"msedge" },
});
