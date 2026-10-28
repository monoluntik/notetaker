import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

// В среде разработки (Node 26, aarch64) `npx playwright install` зависал, поэтому Chromium
// распакован вручную в кэш Playwright. Если его нет — используется браузер, установленный
// штатно (`npx playwright install chromium`). Путь можно задать через PW_CHROMIUM.
const manual = `${homedir()}/.cache/ms-playwright/chromium-1169/chrome-linux/chrome`
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(manual) ? manual : undefined)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    timezoneId: 'Asia/Almaty',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: '../scripts/e2e-backend.sh', url: 'http://127.0.0.1:8011/api/health', reuseExistingServer: false, timeout: 60_000 },
    {
      command: 'npx vite --port 5174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5174',
      env: { VITE_BACKEND_URL: 'http://127.0.0.1:8011' },
      reuseExistingServer: false,
    },
  ],
})
