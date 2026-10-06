import { expect, test, type Page } from '@playwright/test';

/**
 * The TV demo (W5, D44), as in `design/tv-demo.md`. The script runs twice in a row on the production build,
 * with the network off after the demo page has loaded. A full page load needs the network, so the script
 * only ever clicks (client-side navigation) and never reloads.
 */

async function ready(page: Page): Promise<number> {
    const start = Date.now();
    await page.goto('/?demo=tv');
    await page.locator('html[data-demo-ready="true"]').waitFor({ timeout: 60_000 });
    return Date.now() - start;
}

async function openExample(page: Page, title: RegExp) {
    await page.getByRole('link', { name: 'Examples', exact: true }).first().click();
    await page.getByRole('link', { name: title }).first().click();
}

async function runScript(page: Page) {
    const output = page.locator('#output-panel');

    // 1. The landing page: the hero demo runs a rule.
    await page.getByRole('tab', { name: 'Rule' }).click();
    await expect(page.locator('.mb-landing')).toContainText('Passes');

    // 2. A rule with one SQL statement.
    await openExample(page, /No double bookings/);
    await expect(output).toContainText('1 statement reached Postgres');
    await page.getByRole('tab', { name: /^Result/ }).click();
    await page.getByRole('button', { name: /Overlaps bkg-12/ }).click();
    await expect(output).toContainText('Fails');
    await page.getByRole('button', { name: /Free slot/ }).click();
    await expect(output).toContainText('Passes');

    // 3. Exact decimals, typed live.
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('0.1 + 0.2');
    await expect(output).toContainText('DECIMAL · exact');
    await expect(output).toContainText('0.3');

    // 4. A type error, caught before anything runs.
    await openExample(page, /Strict types, on purpose/);
    await page.getByRole('tab', { name: /^Problems/ }).click();
    await expect(output).toContainText(/explicit CAST/);

    // 5. Persian names.
    await openExample(page, /Names in Persian/);
    await page.getByRole('tab', { name: /^Result/ }).click();
    await expect(output).toContainText('علی رضایی');
    await page.getByRole('tab', { name: 'سفارش' }).click();
    await expect(page.getByText(/rows in سفارش/)).toBeVisible();

    // 6. Debug with LOG (the optional extra beat).
    await openExample(page, /Debug with LOG/);
    await page.getByRole('tab', { name: /^Console/ }).click();
    await expect(output).toContainText('3 lines');
    await expect(output).toContainText('bonus(12)');

    // Back to the landing page for the next run.
    await page.getByRole('link', { name: 'Minab home' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('the demo page is ready in under 10 seconds and sets the demo mode', async ({ page }) => {
    const ms = await ready(page);
    console.log(`demo ready in ${ms} ms`);
    expect(ms).toBeLessThan(10_000);
    await expect(page.locator('html')).toHaveAttribute('data-demo', 'tv');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(fontSize).toBe('24px');
});

test('without the flag, nothing changes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-demo', 'tv');
});

test('the whole TV script runs twice in a row with the network off', async ({ page, context }) => {
    await ready(page);
    await context.setOffline(true);
    await runScript(page);
    await runScript(page);
});
