import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3456",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node --input-type=module -e \"import fs from 'node:fs'; try { fs.rmSync('data/afterbuy.e2e.sqlite', { force: true }); } catch {}\" && npx next dev -p 3456 -H 127.0.0.1",
    url: "http://127.0.0.1:3456",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      AFTERBUY_DB_PATH: "data/afterbuy.e2e.sqlite",
      AFTERBUY_FIXTURE_MODE: "1",
    },
  },
});

