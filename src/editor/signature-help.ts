/**
 * Signature help. While the user types the arguments of a call, this says
 * which function it is and which parameter is next. It reads the text, not
 * the syntax tree: `discounted(` with no closing bracket is not a valid
 * program, but it needs help the most.
 */

import { BUILTIN_DOCS, parseSignature } from './builtin-docs.js';
import { hostFunctionDoc, hostFunctionSignature } from './describe.js';
import type { EditorDocument } from './document.js';
import { sourceOf } from './document.js';
import { functionSignature, userFunction } from './hover.js';
import type { SignatureHelpResult } from './types.js';

interface Frame {
    open: string;
    /** The name just before an opening `(`, if any. */
    callee?: string;
    commas: number;
}

/** The calls that are open at `offset`, innermost first: each has a name and the count of arguments before the cursor. */
export function openCallsAt(source: string, offset: number): { name: string; argument: number }[] {
    const stack: Frame[] = [];
    for (let i = 0; i < offset && i < source.length; i++) {
        const c = source[i];
        if (c === '"' || c === "'" || c === '`') {
            for (i++; i < offset && source[i] !== c; i++) if (source[i] === '\\') i++;
        } else if (c === '/' && source[i + 1] === '/') {
            while (i < offset && source[i] !== '\n') i++;
        } else if (c === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            if (end < 0 || end + 2 > offset) return [];
            i = end + 1;
        } else if (c === '(' || c === '[' || c === '{') {
            const frame: Frame = { open: c, commas: 0 };
            if (c === '(') frame.callee = calleeBefore(source, i);
            stack.push(frame);
        } else if (c === ')' || c === ']' || c === '}') {
            stack.pop();
        } else if (c === ',' && stack.length > 0) {
            stack[stack.length - 1].commas++;
        }
    }
    const calls: { name: string; argument: number }[] = [];
    for (let i = stack.length - 1; i >= 0; i--) {
        const frame = stack[i];
        if (frame.open === '(' && frame.callee) calls.push({ name: frame.callee, argument: frame.commas });
    }
    return calls;
}

/** The name written right before the `(` at `index` (spaces allowed between). Quoted names too. */
function calleeBefore(source: string, index: number): string | undefined {
    let end = index;
    while (end > 0 && /\s/.test(source[end - 1])) end--;
    if (source[end - 1] === '`') {
        const start = source.lastIndexOf('`', end - 2);
        return start < 0 ? undefined : source.slice(start + 1, end - 1).replace(/\\(.)/g, '$1');
    }
    const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(source.slice(0, end));
    return match?.[0];
}

export function signatureHelp(doc: EditorDocument, offset: number): SignatureHelpResult | undefined {
    const { schema } = doc.services;
    // The innermost call that is a function. A keyword before a bracket is not one: look further out.
    for (const call of openCallsAt(sourceOf(doc), offset)) {
        const make = (label: string, parameters: string[], documentation?: string): SignatureHelpResult => ({
            label,
            documentation,
            parameters,
            activeParameter: Math.max(0, Math.min(call.argument, parameters.length - 1))
        });
        const builtin = BUILTIN_DOCS[call.name];
        if (builtin) return make(builtin.signature, parseSignature(builtin.signature)?.parameters ?? [], builtin.doc);
        const decl = userFunction(doc, call.name);
        if (decl) {
            const parameters = decl.params.map(p => p.$cstNode?.text.trim() ?? p.name);
            return make(functionSignature(decl), parameters, 'A function of this program (spec §8).');
        }
        const host = schema.getHostFunction(call.name);
        if (host) {
            const signature = hostFunctionSignature(host);
            return make(signature, parseSignature(signature)?.parameters ?? [], hostFunctionDoc(host));
        }
    }
    return undefined;
}
