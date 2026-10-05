#!/usr/bin/env node
/**
 * The `minab-lsp` command: the language server on stdio, for editors that
 * start a server by command (Neovim, Helix, Zed). `src/language/main.ts` does
 * the same for the VS Code extension, which bundles that file.
 */

import { startMinabLanguageServer } from './index.js';

startMinabLanguageServer();
