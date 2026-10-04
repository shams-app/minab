/**
 * The Minab language server process. The VS Code extension bundles this file.
 * The server is in `src/lsp/`: each document uses the `minab.config.json`
 * nearest to it, and a changed config is read again without a restart.
 */

import { startMinabLanguageServer } from '../lsp/index.js';

startMinabLanguageServer();
