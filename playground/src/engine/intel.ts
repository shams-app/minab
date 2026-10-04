/**
 * Editor intelligence for the playground: hover, completion, go-to-definition
 * and the AST view.
 *
 * The work is in `src/editor/`, shared with the language server. This file
 * parses the source on the host's channel and converts the results to the
 * message shapes of `protocol.ts`. Only the AST view is computed here: it is
 * a tool of the playground, not an editor service.
 */

import { isAstNode, type AstNode } from 'langium';
import { complete, definition, hover, typeOf, type EditorDocument } from '../../../src/editor/index.js';
import { formatType } from '../../../src/language/minab-types.js';
import type { LanguageHost } from './language.js';
import { rangeOf } from './program.js';
import type { AstNodeView, CompletionKind, CompletionReport, HoverInfo, Range } from './protocol.js';

/** The playground's kinds are fewer: a host input shows as a variable, a host function as a function. */
const KINDS: Record<string, CompletionKind> = {
    input: 'variable',
    hostFunction: 'function'
};

export class EditorIntel {
    constructor(private readonly language: LanguageHost) {}

    private async open(source: string): Promise<EditorDocument> {
        return {
            services: this.language.services,
            document: await this.language.parse(source, 'intel')
        };
    }

    async hover(source: string, offset: number): Promise<HoverInfo | undefined> {
        return hover(await this.open(source), offset);
    }

    async definition(source: string, offset: number): Promise<Range | undefined> {
        return definition(await this.open(source), offset)?.target;
    }

    async complete(source: string, offset: number): Promise<CompletionReport> {
        const result = await complete(await this.open(source), offset);
        return {
            replace: result.replace,
            entries: result.items.map(item => ({
                ...item,
                kind: KINDS[item.kind] ?? (item.kind as CompletionKind)
            }))
        };
    }

    // ---- AST view -------------------------------------------------------

    async ast(source: string): Promise<AstNodeView | undefined> {
        const doc = await this.open(source);
        const model = doc.document.parseResult.value;
        if (!model) return undefined;
        let budget = 1500;
        const visit = (node: AstNode, feature?: string): AstNodeView => {
            budget--;
            const attributes: AstNodeView['attributes'] = {};
            const children: AstNodeView[] = [];
            for (const [key, value] of Object.entries(node)) {
                if (key.startsWith('$')) continue;
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    if (value !== false && value !== '') attributes[key] = value;
                } else if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                        if (isAstNode(item) && budget > 0) children.push(visit(item, `${key}[${index}]`));
                    });
                } else if (isAstNode(value) && budget > 0) {
                    children.push(visit(value, key));
                }
            }
            const type = node.$type === 'Model' ? undefined : typeOf(doc, node);
            return {
                type: node.$type,
                feature,
                range: rangeOf(node),
                attributes,
                inferredType: type ? formatType(type) : undefined,
                children
            };
        };
        return visit(model);
    }
}
