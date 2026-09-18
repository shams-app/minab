/**
 * The Minab language server (roadmap Phase 7). Wires `createMinabServices`
 * (now built on `langium/lsp`) to a real LSP connection over stdio, so a
 * client like the `vscode-extension/` package gets live diagnostics
 * (`MinabValidator`) and hover/go-to-definition on `#alias`
 * (`./lsp/minab-hover-provider.ts`, `./lsp/minab-definition-provider.ts`)
 * for every open `.minab` file, without running the Phase 6 CLI.
 *
 * Schema/rule-context sourcing is deliberately the simplest thing that
 * satisfies this phase's stated output (syntax highlighting + live
 * diagnostics): one `minab.config.json`, discovered once at startup from
 * the server process's working directory (which a client normally sets to
 * the workspace root), shared by every document. A host that wants a
 * different `MinabSchema` per document — or one that changes without a
 * server restart — is out of scope here; `src/cli/config.ts`'s
 * `discoverConfig`/`loadConfigFile` already do the file-finding and
 * parsing, so this just reuses them instead of a config file per document.
 */

import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { NodeFileSystem } from 'langium/node';
import { startLanguageServer } from 'langium/lsp';
import { discoverConfig, emptyConfig, loadConfigFile } from '../cli/config.js';
import { createMinabServices } from './minab-module.js';

const connection = createConnection(ProposedFeatures.all);

const configPath = discoverConfig(process.cwd());
const config = configPath ? loadConfigFile(configPath) : emptyConfig();

const { shared } = createMinabServices(
    { connection, ...NodeFileSystem },
    config.schema,
    config.ruleContext
);

startLanguageServer(shared);
