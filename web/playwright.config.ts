import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
const previewFile = new URL('../test/scratch/browser/preview.json', import.meta.url);
const managedUrl = process.env.FRONTEND_PREVIEW_URL || (existsSync(previewFile) ? JSON.parse(readFileSync(previewFile, 'utf8')).url : undefined);
const baseURL = managedUrl || 'http://127.0.0.1:4173/preview/';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', timeout: 30000, workers: 1,
  outputDir: '../test/scratch/playwright-output',
  reporter: [['list'], ['json', { outputFile: '../docs/frontend/browser-results.json' }]],
  webServer: managedUrl ? undefined : { command: 'node tests/serve.mjs', url: baseURL, reuseExistingServer: false },
  use: { baseURL, browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1100 },
    launchOptions: { ...(process.env.FRONTEND_CHROMIUM ? { executablePath: process.env.FRONTEND_CHROMIUM } : {}), args: ['--no-sandbox'] } },
});
