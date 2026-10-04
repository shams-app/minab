/**
 * The language server entry of the package (`@shamsine/minab/lsp`). The server
 * itself is in `src/lsp/`. `startMinabServer` is the old name and stays.
 */

import { startMinabLanguageServer } from '../lsp/index.js';

export { startMinabLanguageServer, type MinabLanguageServer, type MinabLanguageServerOptions } from '../lsp/index.js';

/** Starts the language server on stdio. */
export function startMinabServer(): void {
    startMinabLanguageServer();
}
