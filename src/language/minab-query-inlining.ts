/**
 * Two small rules about queries that the checker and the SQL compiler must share:
 *
 *  - the name of a `GROUPBY` key (spec §4.1, D22): `AS name`, else the last field of a plain path;
 *  - when a user `fn` can be inlined into a query (spec §8, D23).
 */
import { AstUtils, type AstNode } from 'langium';
import {
    isCallExpression,
    isCurrentRecord,
    isFunctionDecl,
    isMemberAccess,
    isModel,
    isNameRef,
    isNamedScope,
    isParentRecord,
    isQuery,
    isSubquery,
    type Expression,
    type FunctionDecl,
    type GroupKey,
    type Model
} from './generated/ast.js';
import { isBuiltinName } from './minab-builtins.js';

/** The name `KEY.<name>` uses for this key, or `undefined` for a computed key with no `AS`. */
export function groupKeyName(key: GroupKey): string | undefined {
    if (key.alias !== undefined) return key.alias;
    return plainPathName(key.expression);
}

function plainPathName(expr: Expression): string | undefined {
    if (isCurrentRecord(expr)) return expr.field;
    if (!isMemberAccess(expr)) return undefined;
    let base: Expression = expr.receiver;
    while (isMemberAccess(base)) base = base.receiver;
    const isPath = (isCurrentRecord(base) && base.field !== undefined) || isNamedScope(base) || isNameRef(base) || isParentRecord(base);
    return isPath ? expr.member : undefined;
}

/** The user `fn` a call names, found in the model that holds the call. */
export function findUserFunction(node: AstNode, name: string): FunctionDecl | undefined {
    if (isBuiltinName(name)) return undefined;
    const model = AstUtils.getContainerOfType(node, isModel);
    return model?.declarations.find((d): d is FunctionDecl => isFunctionDecl(d) && d.name === name);
}

/** Why a function cannot be inlined, in words for the error message. `undefined` means it can. */
export function inlineBlocker(decl: FunctionDecl, isHostFunction: (name: string) => boolean): string | undefined {
    return blockerOf(decl, isHostFunction, []);
}

function blockerOf(decl: FunctionDecl, isHost: (name: string) => boolean, stack: FunctionDecl[]): string | undefined {
    if (decl.body.length > 0) return 'it has statements';
    if (!decl.tail) return 'it has no result expression';
    if (isQuery(decl.tail)) return 'it contains a query';
    const model = AstUtils.getContainerOfType(decl, isModel) as Model | undefined;
    const path = [...stack, decl];
    for (const node of [decl.tail, ...AstUtils.streamAllContents(decl.tail)]) {
        if (isQuery(node) || isSubquery(node)) return 'it contains a query';
        if (!isCallExpression(node) || !isNameRef(node.callee)) continue;
        const name = node.callee.name;
        if (isBuiltinName(name)) continue;
        if (isHost(name)) return `it calls the host function "${name}"`;
        const callee = model?.declarations.find((d): d is FunctionDecl => isFunctionDecl(d) && d.name === name);
        if (!callee) continue;
        if (path.includes(callee)) return 'it calls itself (recursion)';
        const inner = blockerOf(callee, isHost, path);
        if (inner) return `it calls "${name}", and ${inner}`;
    }
    return undefined;
}
