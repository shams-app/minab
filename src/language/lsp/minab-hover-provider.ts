/**
 * Hover for `#alias` (roadmap Phase 7). Minab has no Langium cross-
 * references — `#alias` is resolved by `MinabScopeResolver`, not the
 * Linker (see `minab-scope-resolver.ts`) — so the default reference-based
 * hover provider has nothing to key off here. This renders what `#alias`
 * actually resolves to: a declared `FROM`/`JOIN` alias's table, or a bare
 * table name referenced directly.
 */

import type { AstNode } from 'langium';
import { AstNodeHoverProvider } from 'langium/lsp';
import { isNamedScope } from '../generated/ast.js';
import type { MinabServices } from '../minab-module.js';

export class MinabHoverProvider extends AstNodeHoverProvider {
    constructor(private readonly services: MinabServices) {
        super(services);
    }

    protected override getAstNodeHoverContent(node: AstNode): string | undefined {
        if (!isNamedScope(node)) return undefined;
        const result = this.services.scopeResolver.resolveNamedScope(node);
        if (!result.found) return undefined;
        return result.scope.tableName
            ? `\`#${node.name}\` — rows from table \`${result.scope.tableName}\``
            : `\`#${node.name}\` — a query scope (table not statically known)`;
    }
}
