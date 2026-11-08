import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://localhost:4173',
        browserName: 'chromium',
        // A sandbox with a browser already installed can point at it (as the playground's config does).
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {}
    },
    webServer: [
        {
            // The NestJS example (H3), with its tables made: `cd ../nestjs && npm run setup && npm run migrate`.
            command: 'npm start',
            cwd: '../nestjs',
            url: 'http://localhost:3000/reports/top-customers',
            reuseExistingServer: true,
            timeout: 120_000
        },
        {
            command: 'npm run build && npm run preview',
            url: 'http://localhost:4173',
            reuseExistingServer: true,
            timeout: 180_000
        }
    ]
});
