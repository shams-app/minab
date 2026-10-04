import { expect, test, type Request } from '@playwright/test';

/** Requests the page sends to the server (the NestJS example, through the proxy on `/minab`). */
function watchServerRequests(page: import('@playwright/test').Page): Request[] {
    const requests: Request[] = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/minab')) requests.push(request);
    });
    return requests;
}

test('a rule that needs no data runs in the browser, with no request to the server', async ({ page }) => {
    const requests = watchServerRequests(page);
    await page.goto('/#form');
    await page.locator('input[name=start_date]').fill('2026-03-10');
    await page.locator('input[name=end_date]').fill('2026-03-12');
    await expect(page.getByTestId('local-verdict')).toHaveText('valid');
    await page.locator('input[name=end_date]').fill('2026-03-01');
    await expect(page.getByTestId('local-verdict')).toHaveText('invalid');
    expect(requests).toHaveLength(0);
});

test('a rule that needs data goes to the server by program id, with no SQL', async ({ page }) => {
    const requests = watchServerRequests(page);
    await page.goto('/#form');
    await page.locator('input[name=start_date]').fill('2026-03-10');
    await page.locator('input[name=end_date]').fill('2026-03-12');
    await expect(page.getByTestId('local-verdict')).toHaveText('valid');
    expect(requests).toHaveLength(0);

    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('remote-verdict')).toHaveText('valid');
    await expect(page.getByTestId('remote-error')).toHaveText('');

    expect(requests).toHaveLength(1);
    expect(requests[0]!.method()).toBe('POST');
    const raw = requests[0]!.postData() ?? '';
    const body = JSON.parse(raw) as { runs: { program: Record<string, unknown> }[] };
    expect(body.runs[0]!.program).toEqual({ ref: { id: 'order-limit', version: '1' } });
    expect(raw).not.toMatch(/SELECT|FROM "Order"|"sql"|"source"|"schema"/i);
});

/** Monaco loads when the page opens. Wait for it, so the keys go into the editor. */
async function openEditor(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/#editor');
    await page.locator('.monaco-editor textarea').first().waitFor({ state: 'attached' });
    await page.getByTestId('editor').click();
}

test('the editor shows an error marker for a type error', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type('.total + "a"');
    await expect(page.locator('.squiggly-error').first()).toBeAttached();
    await expect(page.getByTestId('problems').locator('li').first()).toContainText(/\w+\.\w+/);
});

test('the editor completes a column after a dot', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type('.');
    const list = page.locator('.suggest-widget.visible');
    await expect(list).toBeVisible();
    await expect(list).toContainText('total');
});
