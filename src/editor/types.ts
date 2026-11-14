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

/** One name the host knows in its directory: a group for `@@name` (MN.4). */
export interface DirectoryName {
    name: string;
    /** The title people read, when it is not the name. */
    title?: string;
    /** What kind of group it is: `system`, `static`, `dynamic`, ... The host's own word. */
    kind?: string;
}

/** How a user shows in an editor: the name, and the e-mail when there is one. */
export interface UserLabel {
    name: string | null;
    email?: string | null;
}

/**
 * What only the host knows and an editor question may use (MN.4). The host gives `directoryNames()` and `userLabels(ids)`
 * to `registerMinab`; the adapter reads them on the main thread and sends the answers with the question.
 */
export interface EditorHints {
    /** The groups of the workspace, for `@@` completion and hover. Without it the editor offers `ruleContext.groupNames`. */
    groups?: readonly DirectoryName[];
    /** User ids to labels, for the hover of a pinned `findUser('usr_…')`. */
    userLabels?: Readonly<Record<string, UserLabel>>;
}

/** A `findUser('usr_…')` with an id as its key: the program's own text pins a person (P4). */
export interface PinnedUser {
    id: string;
    /** The whole call, `findUser('usr_5h2m')`. */
    range: EditorRange;
}

/** A small text the editor shows inside the line, after `position` (an inlay hint). */
export interface InlayHintResult {
    position: EditorPosition;
    label: string;
}

/** `Sara Ahmadi · sara@example.com`. A person who left the workspace has no name: there is no label, and the id is never shown as a name. */
export function userLabelText(label: UserLabel | undefined): string | undefined {
    if (!label) return undefined;
    const parts = [label.name, label.email].filter((part): part is string => !!part);
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** One hint after each pinned call whose label the host knows. */
export function inlayHints(pins: readonly PinnedUser[], labels: Readonly<Record<string, UserLabel>>): InlayHintResult[] {
    return pins.flatMap(pin => {
        const label = userLabelText(labels[pin.id]);
        return label ? [{ position: pin.range.end, label }] : [];
    });
}
