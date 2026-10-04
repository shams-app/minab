import { expect, test } from '@playwright/test';

test('the landing page loads and shows the Minab version', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('minab-version')).toHaveText(/^Minab \d+\.\d+\.\d+/);
});

test('/play?example=booking-overlap runs and shows 1 statement', async ({ page }) => {
    await page.goto('/play?example=booking-overlap');
    await page.getByRole('button', { name: /^Run/ }).click();
    await page.getByRole('tab', { name: /execution/i }).click();
    await expect(page.locator('#output-panel')).toContainText(/\b1 statement\b/);
});

test('a tour lesson goal can be met', async ({ page }) => {
    await page.goto('/learn/01-hello');
    await expect(page.locator('.mb-goal')).toHaveAttribute('data-state', 'open');
    await page.getByRole('button', { name: /show solution/i }).click();
    await page.getByRole('button', { name: /^Run/ }).click();
    await expect(page.locator('.mb-goal')).toHaveAttribute('data-state', 'met');
});
