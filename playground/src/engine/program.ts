/**
 * What a parsed program *is*, before it runs: a query, a rule, or a value;
 * whether it uses constructs the evaluator doesn't execute yet; what it
 * declares; and what type its answer has.
 *
 * The kind and the result type come from the runtime (`PreparedProgram`).
 * The check-only constructs and the symbols still need the syntax tree and
 * their ranges, which the runtime does not give.
 */

import { AstUtils, type AstNode, type LangiumDocument } from 'langium';
import { isFunctionDecl, isVariableDecl, type Model } from '../../../src/language/generated/ast.js';
import type { PreparedProgram } from '../../../src/runtime/index.js';
import type { CheckOnlyConstruct, ProgramInfo, Range } from './protocol.js';

/**
 * Constructs that parse, resolve and type-check but aren't executed yet
 * (README "Status"; `minab-interpreter.ts`). Keyed by AST `$type`.
 */
export const CHECK_ONLY: Record<string, { label: string; specRef: string }> = {
    LoopStatement: { label: 'loops', specRef: '§9.4' },
    BreakStatement: { label: 'break', specRef: '§9.4' },
    ContinueStatement: { label: 'continue', specRef: '§9.4' },
    InsertStatement: { label: 'INSERT', specRef: '§10.1' },
    DeleteStatement: { label: 'DELETE', specRef: '§10.2' },
    UpdateStatement: { label: 'UPDATE', specRef: '§10.3' },
    AssignmentStatement: { label: 'assignment', specRef: '§9.3' },
    IfStatement: { label: 'if! statements', specRef: '§9.1.1' },
    IndexRef: { label: '.$index', specRef: '§3.5' },
    TupleLiteral: { label: 'tuples', specRef: '§7.6' },
    Block: { label: 'statements inside a block', specRef: '§9.1' }
};

export function rangeOf(node: AstNode | undefined): Range | undefined {
    return node?.$cstNode?.range;
}

const EMPTY_RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

function isBlockWithStatements(node: AstNode): boolean {
    const statements = (node as unknown as { statements?: unknown[] }).statements;
    return node.$type === 'Block' && Array.isArray(statements) && statements.length > 0;
}

function checkOnlyConstructs(model: Model): CheckOnlyConstruct[] {
    const found: CheckOnlyConstruct[] = [];
    for (const node of AstUtils.streamAst(model)) {
        const known = CHECK_ONLY[node.$type];
        if (!known) continue;
        if (node.$type === 'Block' && !isBlockWithStatements(node)) continue;
        found.push({ type: node.$type, ...known, range: rangeOf(node) ?? EMPTY_RANGE });
    }
    return found;
}

function typeText(node: AstNode | undefined): string | undefined {
    return node?.$cstNode?.text.replace(/\s+/g, ' ');
}

/**
 * The node a statement event points at: the innermost node with exactly this range (a `Model` can have
 * the same range as its only expression).
 * The runtime gives a range; the Execution tab also shows the node's type and text.
 */
export function nodeAt(document: LangiumDocument<Model>, range: Range): AstNode | undefined {
    let found: AstNode | undefined;
    for (const node of AstUtils.streamAst(document.parseResult.value)) {
        const r = rangeOf(node);
        if (r && r.start.line === range.start.line && r.start.character === range.start.character && r.end.line === range.end.line && r.end.character === range.end.character) {
            found = node;
        }
    }
    return found;
}

export function describeProgram(document: LangiumDocument<Model>, prepared: Pick<PreparedProgram, 'kind' | 'resultType'>): ProgramInfo {
    const model = document.parseResult.value;
    const { kind, resultType } = prepared;

    const symbols: ProgramInfo['symbols'] = [];
    for (const declaration of model.declarations) {
        const range = rangeOf(declaration);
        if (!range) continue;
        if (isFunctionDecl(declaration)) {
            const params = declaration.params.map(p => `${p.name}: ${typeText(p.type) ?? '?'}`).join(', ');
            symbols.push({
                kind: 'function',
                name: declaration.name,
                detail: `fn ${declaration.name}(${params}): ${typeText(declaration.returnType) ?? '?'}`,
                range
            });
        } else if (isVariableDecl(declaration)) {
            symbols.push({ kind: 'variable', name: declaration.name, detail: typeText(declaration.type), range });
        }
    }

    const constructs = checkOnlyConstructs(model);
    return { kind, checkOnly: constructs.length > 0, checkOnlyConstructs: constructs, resultType, symbols };
}

/**
 * Turns the interpreter's "not executed yet" refusals into something a
 * reader can act on, or `undefined` when the failure is a real error.
 */
export function explainRefusal(reason: string): { construct: string; label: string; specRef: string } | undefined {
    if (!/is not (executed|evaluated) yet|are not executed yet/.test(reason)) return undefined;
    if (reason.startsWith('statements inside a block')) return { construct: 'Block', ...CHECK_ONLY.Block };
    if (reason.startsWith('".$index"')) return { construct: 'IndexRef', ...CHECK_ONLY.IndexRef };
    const type = /^"(\w+)"/.exec(reason)?.[1];
    if (type && CHECK_ONLY[type]) return { construct: type, ...CHECK_ONLY[type] };
    return { construct: type ?? 'unknown', label: type ?? 'this construct', specRef: '' };
}
