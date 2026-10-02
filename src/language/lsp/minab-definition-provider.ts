/**
 * Go-to-definition for `#alias` (roadmap Phase 7). Same reasoning as
 * `minab-hover-provider.ts`: `#alias` isn't a Langium cross-reference, so
 * `DefaultDefinitionProvider` (which walks the Linker's resolved
 * references) never sees it. This implements `DefinitionProvider` directly,
 * finding the AST node under the cursor and resolving it the same way the
 * `Validator`'s `NamedScope` check does — via `MinabScopeResolver` — then
 * pointing at the declaring `FROM ... AS alias` (on the `Query` itself) or
 * `JOIN ... AS alias` (on the `JoinClause`) node.
 */

import { CstUtils, GrammarUtils, type LangiumDocument } from 'langium';
import type { DefinitionProvider } from 'langium/lsp';
import type { DefinitionParams, LocationLink } from 'vscode-languageserver';
import { isNamedScope } from '../generated/ast.js';
import type { MinabServices } from '../minab-module.js';

export class MinabDefinitionProvider implements DefinitionProvider {
    constructor(private readonly services: MinabServices) {}

    getDefinition(document: LangiumDocument, params: DefinitionParams): LocationLink[] | undefined {
        const rootCst = document.parseResult.value.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);
        const leaf = CstUtils.findLeafNodeAtOffset(rootCst, offset);
        const node = leaf?.astNode;
        if (!leaf || !node || !isNamedScope(node)) return undefined;

        const result = this.services.scopeResolver.resolveNamedScope(node);
        if (!result.found) return undefined;

        const ownerCst = result.scope.owner.$cstNode;
        if (!ownerCst) return undefined;
        // The owner is the whole `Query`/`JoinClause`; point at its `alias`
        // property specifically, falling back to the whole node when
        // there's no declared alias to point at (a bare table reference).
        const targetCst = GrammarUtils.findNodeForProperty(ownerCst, 'alias') ?? ownerCst;

        return [
            {
                targetUri: document.uri.toString(),
                targetRange: targetCst.range,
                targetSelectionRange: targetCst.range,
                originSelectionRange: leaf.range
            }
        ];
    }
}
