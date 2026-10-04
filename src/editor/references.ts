/**
 * Find references and rename, inside one document. They work for the names a
 * program declares: `let`, parameters, loop variables, `fn` and aliases (`AS`).
 * Schema names (tables, columns) belong to the host, so they are not here.
 *
 * Minab has no Langium cross-references, so every use is found with the scope
 * resolver, like in go to definition. A column after `.` is a property of the
 * record, not a name, so it is never a use.
 */

import { AstUtils, GrammarUtils, type AstNode, type CstNode } from 'langium';
import {
    isCallExpression,
    isFunctionDecl,
    isJoinClause,
    isJsonProperty,
    isLoopStatement,
    isNamedScope,
    isNameRef,
    isParam,
    isQuery,
    isVariableDecl,
    type FunctionDecl,
    type NameRef
} from '../language/generated/ast.js';
import { coded } from '../language/diagnostics/codes.js';
import type { EditorDocument } from './document.js';
import { parseDocument, positionAt, sourceOf } from './document.js';
import { userFunction } from './hover.js';
import type { PrepareRenameResult, ReferenceResult, RenameResult, TextEdit } from './types.js';

/** One place that holds the name of a declaration: the declaration itself, or a use of it. */
interface Occurrence {
    owner: AstNode;
    /** The name only. */
    name: CstNode;
    isDeclaration: boolean;
    /** `{ total }` in a JSON object means `{ total: total }`: a rename must keep the key. */
    shorthand: boolean;
}

/** The property that holds the name of a declaration, or `undefined` when the node declares no name. */
function nameProperty(owner: AstNode): string | undefined {
    if (isFunctionDecl(owner) || isVariableDecl(owner) || isParam(owner)) return 'name';
    if (isQuery(owner) || isJoinClause(owner)) return 'alias';
    if (isLoopStatement(owner) && owner.variable) return 'variable';
    return undefined;
}

/** The part of a declaration that holds its name. A query without `AS` has none. */
export function declarationName(owner: AstNode): CstNode | undefined {
    const property = nameProperty(owner);
    return property && owner.$cstNode ? GrammarUtils.findNodeForProperty(owner.$cstNode, property) : undefined;
}

function declaredName(owner: AstNode): string {
    const property = nameProperty(owner);
    return String((owner as unknown as Record<string, unknown>)[property ?? 'name']);
}

/** What a name that is used in an expression refers to, when it is a declaration of this program. */
function ownerOfNameRef(doc: EditorDocument, node: NameRef): AstNode | undefined {
    if (isCallExpression(node.$container) && node.$container.callee === node) return userFunction(doc, node.name);
    const result = doc.services.scopeResolver.resolveNameRef(node);
    // A host input has the reference itself as owner: the host declares it.
    return result.found && result.scope.owner !== node ? result.scope.owner : undefined;
}

function occurrencesOf(doc: EditorDocument): Occurrence[] {
    const model = doc.document.parseResult.value;
    const { scopeResolver } = doc.services;
    const found: Occurrence[] = [];
    const add = (owner: AstNode | undefined, name: CstNode | undefined, isDeclaration: boolean, shorthand = false) => {
        if (owner && name) found.push({ owner, name, isDeclaration, shorthand });
    };
    for (const node of AstUtils.streamAllContents(model)) {
        if (nameProperty(node)) {
            add(node, declarationName(node), true);
        } else if (isNameRef(node)) {
            add(ownerOfNameRef(doc, node), node.$cstNode, false);
        } else if (isNamedScope(node)) {
            const result = scopeResolver.resolveNamedScope(node);
            // A `#Table` has itself as owner: the table is declared by the host.
            const owner = result.found && result.scope.owner !== node ? result.scope.owner : undefined;
            add(owner, node.$cstNode && GrammarUtils.findNodeForProperty(node.$cstNode, 'name'), false);
        } else if (isJsonProperty(node) && node.value === undefined) {
            // The grammar has no `NameRef` here: ask the resolver as if there were one.
            const stand = { $type: 'NameRef', $container: node, name: node.key } as unknown as NameRef;
            add(ownerOfNameRef(doc, stand), node.$cstNode && GrammarUtils.findNodeForProperty(node.$cstNode, 'key'), false, true);
        }
    }
    return found.sort((a, b) => a.name.offset - b.name.offset);
}

function occurrenceAt(found: Occurrence[], offset: number): Occurrence | undefined {
    // A cursor at the end of a name still belongs to it, but a name that starts there wins.
    return found.find(o => o.name.offset <= offset && offset < o.name.end) ?? found.find(o => o.name.end === offset);
}

/** Every place that names the symbol at `offset`. Empty when the cursor is not on a name this program declares. */
export function findReferences(doc: EditorDocument, offset: number, includeDeclaration = true): ReferenceResult[] {
    const found = occurrencesOf(doc);
    const at = occurrenceAt(found, offset);
    if (!at) return [];
    return found
        .filter(o => o.owner === at.owner && (includeDeclaration || !o.isDeclaration))
        .map(o => ({ range: o.name.range, isDeclaration: o.isDeclaration }));
}

export function prepareRename(doc: EditorDocument, offset: number): PrepareRenameResult | undefined {
    const at = occurrenceAt(occurrencesOf(doc), offset);
    return at ? { range: at.name.range, placeholder: declaredName(at.owner) } : undefined;
}

/** What the user typed as a new name: the name itself, and the text to write for it. */
function readNewName(doc: EditorDocument, input: string): { name: string; text: string } | undefined {
    const typed = input.trim();
    if (typed === '') return undefined;
    const { tokens, errors } = doc.services.parser.Lexer.tokenize(typed);
    const single = errors.length === 0 && tokens.length === 1 ? tokens[0].tokenType.name : undefined;
    // `ID` is a plain name. A keyword, or any other text, needs backticks (spec §2.4).
    if (single === 'ID') return { name: typed, text: typed };
    if (single === 'QUOTED_NAME') return { name: typed.slice(1, -1).replace(/\\([\s\S])/g, '$1'), text: typed };
    return { name: typed, text: '`' + typed.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`' };
}

/** The reason the new name breaks a rule of the language (D10, D11, no duplicate in one scope), if it does. */
function nameProblem(doc: EditorDocument, owner: AstNode, name: string): string | undefined {
    const { schema } = doc.services;
    const model = doc.document.parseResult.value;
    const functions = model.declarations.filter(isFunctionDecl);
    if (name === declaredName(owner)) return undefined;
    if (isFunctionDecl(owner)) {
        if (!/\p{Ll}/u.test(name)) return coded('call.functionNameCase', { name }).reason;
        if (schema.getTable(name)) return coded('scope.functionNameIsTable', { name }).reason;
        if (schema.isHostName(name)) return coded('scope.nameIsHostName', { name }).reason;
        if (functions.some(f => f.name === name)) return `a function named "${name}" is already declared`;
        // D11: a `let` or a parameter may not have the name of a function.
        for (const node of AstUtils.streamAllContents(model)) {
            if ((isVariableDecl(node) || isParam(node)) && node.name === name) return coded('scope.nameIsFunction', { name }).reason;
        }
        return undefined;
    }
    if (isVariableDecl(owner) || isParam(owner) || isLoopStatement(owner)) {
        if (functions.some(f => f.name === name)) return coded('scope.nameIsFunction', { name }).reason;
        if (schema.isHostName(name)) return coded('scope.nameIsHostName', { name }).reason;
    }
    if (isVariableDecl(owner) && owner.$container) {
        const siblings = (owner.$container as unknown as Record<string, unknown>)[owner.$containerProperty ?? ''];
        if (Array.isArray(siblings) && siblings.some(s => isVariableDecl(s) && s !== owner && s.name === name)) {
            return coded('scope.duplicateLet', { name }).reason;
        }
    }
    if (isParam(owner) && (owner.$container as FunctionDecl).params.some(p => p !== owner && p.name === name)) {
        return `a parameter named "${name}" is already declared`;
    }
    return undefined;
}

interface Replacement {
    start: number;
    end: number;
    text: string;
    /** Where the name starts after all replacements, relative to `start`. */
    nameShift: number;
}

/**
 * Renames the symbol at `offset` in this document. `input` is what the user
 * typed: a plain name, or a name that needs backticks (the edit adds them).
 * The rename is refused, with a message, when the name breaks a rule of the
 * language or when it would change what another name in the program means.
 */
export function rename(doc: EditorDocument, offset: number, input: string): RenameResult {
    const found = occurrencesOf(doc);
    const at = occurrenceAt(found, offset);
    if (!at) return { ok: false, message: 'Only a name this program declares can be renamed: a let, a parameter, a loop variable, a function or an alias.' };
    const next = readNewName(doc, input);
    if (!next) return { ok: false, message: 'The new name is empty.' };
    const problem = nameProblem(doc, at.owner, next.name);
    if (problem) return { ok: false, message: problem };

    const source = sourceOf(doc);
    const own = found.filter(o => o.owner === at.owner);
    const replacements: Replacement[] = own.map(o => {
        const key = source.slice(o.name.offset, o.name.end);
        return o.shorthand
            ? { start: o.name.offset, end: o.name.end, text: `${key}: ${next.text}`, nameShift: key.length + 2 }
            : { start: o.name.offset, end: o.name.end, text: next.text, nameShift: 0 };
    });

    // Parse the result: every use must still point at the same declaration (no capture by another name).
    let shift = 0;
    const expected: number[] = [];
    let text = '';
    let last = 0;
    for (const r of replacements) {
        expected.push(r.start + shift + r.nameShift);
        text += source.slice(last, r.start) + r.text;
        shift += r.text.length - (r.end - r.start);
        last = r.end;
    }
    text += source.slice(last);
    const after = occurrencesOf(parseDocument(doc.services, text));
    const declarations = found.filter(o => o.isDeclaration);
    const ordinal = declarations.findIndex(o => o.owner === at.owner);
    const declaration = after.filter(o => o.isDeclaration)[ordinal];
    const actual = declaration ? after.filter(o => o.owner === declaration.owner).map(o => o.name.offset) : [];
    if (actual.length !== expected.length || actual.some((o, i) => o !== expected[i])) {
        return { ok: false, message: `"${next.name}" would change what a name in this program refers to. Pick another name.` };
    }

    const edits: TextEdit[] = replacements.map(r => ({
        range: { start: positionAt(source, r.start), end: positionAt(source, r.end) },
        newText: r.text
    }));
    return { ok: true, edits };
}
