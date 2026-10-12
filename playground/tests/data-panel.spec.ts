import { expect, test, type Page } from '@playwright/test';

/**
 * The Data panel follows the open example (W6): it shows the tables of the example's dataset, after a
 * client-side switch between datasets and after a direct page load of `/play?example=…`.
 */

async function openExample(page: Page, title: RegExp) {
    await page.getByRole('link', { name: 'Examples', exact: true }).first().click();
    await page.getByRole('link', { name: title }).first().click();
}

function dataTab(page: Page) {
    return page.locator('#host-tab-data');
}

function tableTabs(page: Page) {
    return page.getByRole('tablist', { name: 'Tables' }).getByRole('tab');
}

test('switching between datasets shows the open example’s tables', async ({ page }) => {
    await page.goto('/play?example=first-query');
    await dataTab(page).click();
    await expect(page.getByText(/rows in Customer/)).toBeVisible();

    await openExample(page, /Names in Persian/);
    await dataTab(page).click();
    await expect(tableTabs(page)).toHaveText(['مشتری', 'سفارش']);
    await expect(page.getByText(/rows in مشتری/)).toBeVisible();
    await expect(page.locator('#host-panel')).not.toContainText('Customer');

    await openExample(page, /Top customers/);
    await dataTab(page).click();
    await expect(page.getByText(/rows in Customer/)).toBeVisible();
    await expect(page.locator('#host-panel')).not.toContainText('مشتری');
});

test('a direct page load of the Persian example shows its tables, with no error', async ({ page }) => {
    await page.goto('/play?example=persian-names');
    await dataTab(page).click();
    await expect(page.getByText(/rows in مشتری/)).toBeVisible();
    await expect(page.locator('#host-panel')).not.toContainText('unknown table');
});

test('the SQL console starts with a query on a table of the dataset', async ({ page }) => {
    await page.goto('/play?example=persian-names');
    await dataTab(page).click();
    await page.getByRole('button', { name: 'SQL console' }).click();
    await expect(page.locator('#sql-console-input')).toHaveValue('SELECT * FROM "مشتری" LIMIT 10;');
    await page.getByRole('button', { name: 'Run SQL' }).click();
    await expect(page.getByRole('region', { name: 'SQL console result' })).toContainText('مریم احمدی');
});
