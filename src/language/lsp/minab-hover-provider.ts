/**
 * Hover for the language server. Minab has no Langium cross-references —
 * `#alias` is resolved by `MinabScopeResolver`, not the Linker — so the
 * default reference-based hover provider has nothing to key off. The text
 * comes from `src/editor/`, the same code the playground uses. This class
 * only turns its result into an LSP `Hover`.
 */

import type { LangiumDocument } from 'langium';
import type { Model } from '../generated/ast.js';
import type { HoverProvider } from 'langium/lsp';
import type { Hover, HoverParams } from 'vscode-languageserver';
import { hover } from '../../editor/hover.js';
import type { MinabServices } from '../minab-module.js';

export class MinabHoverProvider implements HoverProvider {
    constructor(private readonly services: MinabServices) {}

    getHoverContent(document: LangiumDocument, params: HoverParams): Hover | undefined {
        const result = hover({ services: this.services, document: document as LangiumDocument<Model> }, document.textDocument.offsetAt(params.position));
        // A keyword has no text here. The editor host may document it itself.
        if (!result || !result.contents) return undefined;
        return {
            contents: { kind: 'markdown', value: result.contents },
            range: result.range
        };
    }
}
