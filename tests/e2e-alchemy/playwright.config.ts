import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

const apiConfig = fileURLToPath(new URL('./api.vite.config.ts', import.meta.url))
const frontendConfig = fileURLToPath(new URL('./vite.config.ts', import.meta.url))
// One workerd hosts two actual user Workers and one native D1 service.
// Every run gets fresh disk storage. No second process opens its SQLite file.
// Keep historical ignored failure/report evidence intact when Playwright cleans outputs.
// Worker processes re-evaluate this config, so inherit the runner's ID rather
// than splitting their screenshots and audits into independent directories.
const runId = (process.env.PROJEKTOR_E2E_RUN_ID ??= randomUUID())
const runDirectory = new URL(`./.runtime/${runId}/`, import.meta.url)
const storageDirectory = fileURLToPath(new URL('storage/', runDirectory))

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  outputDir: fileURLToPath(new URL('test-results/', runDirectory)),
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: fileURLToPath(new URL('playwright-report/', runDirectory)),
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4393',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `vp build --config "${apiConfig}" && vp build --config "${frontendConfig}" && vp preview --config "${frontendConfig}" --host 127.0.0.1 --port 4393 --strictPort`,
    env: { PROJEKTOR_E2E_STORAGE_DIRECTORY: storageDirectory },
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    // The API-only test adapter applies migrations on its first request.
    // Bootstrap it explicitly: Web no longer calls the API to initialize D1.
    // Every browser case then exercises the independently authenticated Web Worker.
    url: 'http://127.0.0.1:4392/auth/me',
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
