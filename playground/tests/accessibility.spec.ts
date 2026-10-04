import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ROUTES, THEMES } from './routes';

for (const theme of THEMES) {
    for (const route of ROUTES) {
        test(`axe: ${route} in ${theme}`, async ({ page }) => {
            await page.addInitScript(t => {
                try {
                    localStorage.setItem('theme', JSON.stringify(t));
                } catch {
                    // storage can be blocked
                }
            }, theme);
            await page.emulateMedia({ colorScheme: theme });
            await page.goto(route);
            await page.locator('#root > *').first().waitFor();
            // Make sure the manual theme is the one applied, whatever key the app uses.
            await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
            const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
            expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)).toEqual([]);
        });
    }
}
