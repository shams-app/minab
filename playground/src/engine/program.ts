/**
 * What a parsed program *is*, before it runs: a query, a rule, or a value;
 * whether it uses constructs the evaluator doesn't execute yet; what it
 * declares; and what type its answer has.
 */

import { AstUtils, type AstNode, type LangiumDocument } from 'langium';
import {
    isFunctionDecl,
    isQuery,
    isVariableDecl,
    type Model
} from '../../../src/language/generated/ast.js';
import { formatType } from '../../../src/language/minab-types.js';
import type { MinabServices } from '../../../src/language/minab-module.js';
import type { CheckOnlyConstruct, ProgramInfo, ProgramKind, Range } from './protocol.js';

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

export function describeProgram(document: LangiumDocument<Model>, services: MinabServices): ProgramInfo {
    const model = document.parseResult.value;
    const ruleContext = services.ruleContext;
    const tail = model.tail;

    let kind: ProgramKind;
    if (!tail) kind = model.declarations.length === 0 ? 'empty' : 'value';
    else if (isQuery(tail)) kind = 'query';
    else if (ruleContext.isFieldRule) kind = 'field-rule';
    else if (ruleContext.recordTable) kind = 'record-rule';
    else kind = 'value';

    let resultType: string | undefined;
    if (tail && !isQuery(tail)) {
        try {
            const inferred = services.typeChecker.inferType(tail);
            if (inferred.ok) resultType = formatType(inferred.type);
        } catch {
            // A half-parsed tail can trip inference; the type is a nicety, not a requirement.
        }
    }

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
