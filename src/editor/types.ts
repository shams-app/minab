/**
 * The shapes the editor functions return. They have no Node, DOM, LSP or
 * Monaco types. Lines and columns are 0-based, like the language server. An
 * adapter (the playground, the language server, Monaco) converts them.
 */

export interface EditorPosition {
    line: number;
    character: number;
}

export interface EditorRange {
    start: EditorPosition;
    end: EditorPosition;
}

export interface HoverResult {
    /** Markdown. Empty when only `keyword` is set. */
    contents: string;
    range?: EditorRange;
    /** The hovered token is this keyword. The host may document it itself. */
    keyword?: string;
}

export type CompletionKind = 'keyword' | 'table' | 'column' | 'function' | 'builtin' | 'variable' | 'input' | 'hostFunction' | 'type';

export interface CompletionItem {
    label: string;
    kind: CompletionKind;
    /** A type or a signature. */
    detail?: string;
    /** One sentence or a short Markdown table. */
    documentation?: string;
    /** Text to insert when it is not the label. `$1`, `${1:name}` mark snippet stops. */
    insertText?: string;
    /** Sort bucket: lower sorts first. */
    rank: number;
}

export interface CompletionResult {
    /** The partial word the user is typing. An item replaces it. */
    replace: EditorRange;
    items: CompletionItem[];
}

export interface DefinitionResult {
    /** The token under the cursor. */
    origin: EditorRange;
    /** The name at the place of the declaration. */
    target: EditorRange;
}

export interface SignatureHelpResult {
    /** The whole signature, for example `ROUND(n: N, digits?: INTEGER) → N`. */
    label: string;
    documentation?: string;
    /** Each parameter as written in `label`. */
    parameters: string[];
    /** Index into `parameters`. Past the last one it stays on the last. */
    activeParameter: number;
}
