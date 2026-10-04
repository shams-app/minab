import { defineConfig } from '@playwright/test';

/**
 * Site checks (W4): they run against `vite preview` of the production build,
 * so run `npm run build` first. `CHROMIUM_PATH` points at an installed
 * Chromium when `npx playwright install` is not possible.
 */
export default defineConfig({
    testDir: 'tests',
    timeout: 60_000,
    expect: { timeout: 30_000 },
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://localhost:4173',
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] }
    },
    webServer: {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI
    }
});
