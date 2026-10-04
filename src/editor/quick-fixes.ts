/**
 * Quick fixes for the two errors users meet most. Each one reads the stable
 * code of a diagnostic and its parameters (`src/language/diagnostics/codes.ts`):
 *
 * - `call.unknownFunction` and `scope.unknownName`: "Did you mean …?" with the
 *   closest names in scope (at most 3);
 * - `type.implicitCoercion`: "Add CAST(… AS T)", on either side of the operator.
 */

import { CstUtils, type AstNode } from 'langium';
import {
    isBinaryExpression,
    isBlock,
    isFunctionDecl,
    isLoopStatement,
    isModel,
    isNameRef,
    isQuery,
    isVariableDecl,
    type BinaryExpression,
    type NameRef
} from '../language/generated/ast.js';
import { builtinNames } from '../language/minab-builtins.js';
import type { EditorDocument } from './document.js';
import { nameText } from './describe.js';
import type { EditorRange, FixableDiagnostic, QuickFix } from './types.js';

const MAX_SUGGESTIONS = 3;

/** The number of single-letter changes between two words. */
function editDistance(a: string, b: string): number {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) {
            next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        row = next;
    }
    return row[b.length];
}

/** The closest candidates to `name`, nearest first. Case does not count: `sum` is close to `SUM`. */
function closest(name: string, candidates: Iterable<string>): string[] {
    const word = name.toLowerCase();
    const limit = Math.max(2, Math.floor(word.length / 3));
    const scored = new Map<string, number>();
    for (const candidate of candidates) {
        const distance = editDistance(word, candidate.toLowerCase());
        if (candidate !== name && distance <= limit) scored.set(candidate, distance);
    }
    return [...scored]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_SUGGESTIONS)
        .map(([candidate]) => candidate);
}

/** The names a bare name can mean at `node`: variables, parameters, loop variables, aliases and host inputs. */
function namesInScope(doc: EditorDocument, node: AstNode): Set<string> {
    const names = new Set<string>(doc.services.schema.hostInputs().keys());
    let child: AstNode = node;
    for (let current = node.$container; current; child = current, current = current.$container) {
        if (isFunctionDecl(current)) current.params.forEach(p => names.add(p.name));
        if (isQuery(current) && current.source !== child) {
            if (current.alias) names.add(current.alias);
            current.joins.forEach(j => names.add(j.alias));
        }
        if (isLoopStatement(current) && current.variable) names.add(current.variable);
        const statements = isBlock(current)
            ? current.statements
            : isFunctionDecl(current)
              ? current.body
              : isLoopStatement(current)
                ? current.statements
                : isModel(current)
                  ? current.declarations
                  : [];
        statements.filter(isVariableDecl).forEach(v => names.add(v.name));
    }
    return names;
}

function callableNames(doc: EditorDocument): Set<string> {
    const names = new Set<string>(builtinNames());
    doc.document.parseResult.value.declarations.filter(isFunctionDecl).forEach(f => names.add(f.name));
    doc.services.schema.hostFunctions().forEach((_, name) => names.add(name));
    return names;
}

function sameRange(a: EditorRange, b: EditorRange): boolean {
    return a.start.line === b.start.line && a.start.character === b.start.character && a.end.line === b.end.line && a.end.character === b.end.character;
}

/** The name the diagnostic is about: it starts where the diagnostic starts. */
function nameRefAt(doc: EditorDocument, diagnostic: FixableDiagnostic): NameRef | undefined {
    const root = doc.document.parseResult.value.$cstNode;
    const leaf = root && CstUtils.findLeafNodeAtOffset(root, doc.document.textDocument.offsetAt(diagnostic.range.start));
    const node = leaf?.astNode;
    return node && isNameRef(node) && node.name === String(diagnostic.params.name) ? node : undefined;
}

function didYouMean(doc: EditorDocument, diagnostic: FixableDiagnostic, candidates: (node: NameRef) => Iterable<string>): QuickFix[] {
    const node = nameRefAt(doc, diagnostic);
    const range = node?.$cstNode?.range;
    if (!node || !range) return [];
    return closest(node.name, candidates(node)).map(candidate => ({
        title: `Did you mean ${nameText(candidate)}?`,
        edits: [{ range, newText: nameText(candidate) }]
    }));
}

/** A type that `CAST ... AS` accepts, with nullability dropped. A record, a collection or `null` has none. */
function castTarget(type: unknown): string | undefined {
    return typeof type === 'string' && /^(TEXT|CITEXT|INTEGER|DECIMAL|BOOLEAN|DATE|TIME|DATETIME|UUID|JSON)\??(\[\]\??)?$/.test(type)
        ? type.replace(/\?/g, '')
        : undefined;
}

function binaryAt(doc: EditorDocument, diagnostic: FixableDiagnostic): BinaryExpression | undefined {
    const root = doc.document.parseResult.value.$cstNode;
    const leaf = root && CstUtils.findLeafNodeAtOffset(root, doc.document.textDocument.offsetAt(diagnostic.range.start));
    for (let node: AstNode | undefined = leaf?.astNode; node; node = node.$container) {
        if (isBinaryExpression(node) && node.$cstNode && sameRange(node.$cstNode.range, diagnostic.range)) return node;
    }
    return undefined;
}

function addCast(doc: EditorDocument, diagnostic: FixableDiagnostic): QuickFix[] {
    const node = binaryAt(doc, diagnostic);
    if (!node) return [];
    const fixes: QuickFix[] = [];
    const sides = [
        { side: 'left', operand: node.left, own: diagnostic.params.left, other: diagnostic.params.right },
        { side: 'right', operand: node.right, own: diagnostic.params.right, other: diagnostic.params.left }
    ] as const;
    for (const { side, operand, own, other } of sides) {
        const cst = operand.$cstNode;
        const target = castTarget(other);
        // Both types must be ones that CAST knows: a collection or a record is not cast.
        if (!target || !castTarget(own) || !cst) continue;
        fixes.push({
            title: `Add CAST(… AS ${target}) around the ${side} side`,
            edits: [{ range: cst.range, newText: `CAST(${cst.text} AS ${target})` }]
        });
    }
    return fixes;
}

/** The quick fixes of one diagnostic. Empty when the code has none. */
export function quickFixes(doc: EditorDocument, diagnostic: FixableDiagnostic): QuickFix[] {
    switch (diagnostic.code) {
        case 'call.unknownFunction':
            return didYouMean(doc, diagnostic, () => callableNames(doc));
        case 'scope.unknownName':
            return didYouMean(doc, diagnostic, node => namesInScope(doc, node));
        case 'type.implicitCoercion':
            return addCast(doc, diagnostic);
        default:
            return [];
    }
}
