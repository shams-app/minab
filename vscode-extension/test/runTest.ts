/**
 * Starts a real VS Code, opens the `type-error` fixture folder with the
 * extension loaded, and runs `suite/index.ts` inside it.
 * Run it with `npm test` (it needs a display: on Linux use `xvfb-run -a npm test`).
 */

import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
    const workspace = path.resolve(extensionDevelopmentPath, 'test', 'fixtures', 'type-error');
    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        // No other extensions, and no first-run noise.
        launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust']
    });
}

main().catch(error => {
    console.error('The extension smoke test failed:', error);
    process.exit(1);
});
