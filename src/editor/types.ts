/**
 * The shapes the editor functions return. They have no Node, DOM, LSP or
 * Monaco types. Lines and columns are 0-based, like the language server. An
 * adapter (the playground, the language server, Monaco) converts them.
 */

/** A place in a text. Both numbers are 0-based, like the language server protocol. */
export interface EditorPosition {
    line: number;
    character: number;
}

/** A part of a text, from `start` up to `end`. */
export interface EditorRange {
    start: EditorPosition;
    end: EditorPosition;
}

/** What to show when the pointer rests on a symbol. */
export interface HoverResult {
    /** Markdown. Empty when only `keyword` is set. */
    contents: string;
    range?: EditorRange;
    /** The hovered token is this keyword. The host may document it itself. */
    keyword?: string;
}

/** What a completion item is. */
export type CompletionKind = 'keyword' | 'table' | 'column' | 'function' | 'builtin' | 'variable' | 'input' | 'hostFunction' | 'type';

/** One suggestion of the completion list. */
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

/** The completion list at one place in a program. */
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

/** The signature of the call at one place in a program, and which parameter is active. */
export interface SignatureHelpResult {
    /** The whole signature, for example `ROUND(n: N, digits?: INTEGER) → N`. */
    label: string;
    documentation?: string;
    /** Each parameter as written in `label`. */
    parameters: string[];
    /** Index into `parameters`. Past the last one it stays on the last. */
    activeParameter: number;
}

export type SymbolKind = 'function' | 'parameter' | 'variable' | 'alias';

export interface DocumentSymbolResult {
    name: string;
    kind: SymbolKind;
    /** For a `fn`: its signature. For a `let` or a parameter: its type. */
    detail?: string;
    /** The whole declaration. */
    range: EditorRange;
    /** The name inside the declaration. */
    selectionRange: EditorRange;
    children: DocumentSymbolResult[];
}

export interface ReferenceResult {
    /** The name only: for `#alias` the part after the `#`, for a quoted name the backticks too. */
    range: EditorRange;
    isDeclaration: boolean;
}

export interface TextEdit {
    range: EditorRange;
    newText: string;
}

export type PrepareRenameResult = { range: EditorRange; placeholder: string };

export type RenameResult = { ok: true; edits: TextEdit[] } | { ok: false; message: string };

/** The token types of the legend, in order. The adapter sends this list to the client. */
export const SEMANTIC_TOKEN_TYPES = ['keyword', 'operator', 'type', 'function', 'parameter', 'variable', 'property', 'class', 'namespace'] as const;
/** The token modifiers of the legend, in order. `host` is not a standard one: a host function or input. */
export const SEMANTIC_TOKEN_MODIFIERS = ['declaration', 'defaultLibrary', 'host'] as const;

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];
export type SemanticTokenModifier = (typeof SEMANTIC_TOKEN_MODIFIERS)[number];

export interface SemanticToken {
    line: number;
    character: number;
    length: number;
    type: SemanticTokenType;
    modifiers: SemanticTokenModifier[];
}

/** A diagnostic as a quick fix needs it: the stable code, where it is, and its parameters. */
export interface FixableDiagnostic {
    code: string;
    range: EditorRange;
    params: Record<string, string | number>;
}

export interface QuickFix {
    title: string;
    edits: TextEdit[];
}
