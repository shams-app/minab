/**
 * Go-to-definition for the language server. `#alias` and the names of the
 * program are not Langium cross-references, so `DefaultDefinitionProvider`
 * (which walks the Linker's resolved references) never sees them. The lookup
 * is in `src/editor/definition.ts`, shared with the playground. This class
 * only turns its result into an LSP `LocationLink`.
 */

import type { LangiumDocument } from 'langium';
import type { Model } from '../generated/ast.js';
import type { DefinitionProvider } from 'langium/lsp';
import type { DefinitionParams, LocationLink } from 'vscode-languageserver';
import { definition } from '../../editor/definition.js';
import type { MinabServices } from '../minab-module.js';

export class MinabDefinitionProvider implements DefinitionProvider {
    constructor(private readonly services: MinabServices) {}

    getDefinition(document: LangiumDocument, params: DefinitionParams): LocationLink[] | undefined {
        const result = definition({ services: this.services, document: document as LangiumDocument<Model> }, document.textDocument.offsetAt(params.position));
        if (!result) return undefined;
        return [
            {
                targetUri: document.uri.toString(),
                targetRange: result.target,
                targetSelectionRange: result.target,
                originSelectionRange: result.origin
            }
        ];
    }
}
