/** Editor services: completion, hover, go to definition, signature help, symbols, references, rename, semantic tokens and quick fixes. No Node, DOM, LSP or Monaco types. */

export { complete } from './complete.js';
export { definition } from './definition.js';
export { parseDocument, type EditorDocument } from './document.js';
export { hover, typeOf } from './hover.js';
export { signatureHelp } from './signature-help.js';
export { quickFixes } from './quick-fixes.js';
export { findReferences, prepareRename, rename } from './references.js';
export { semanticTokens } from './semantic-tokens.js';
export { documentSymbols } from './symbols.js';
export { BUILTIN_DOCS } from './builtin-docs.js';
export { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from './types.js';
export type {
    CompletionItem,
    CompletionKind,
    CompletionResult,
    DefinitionResult,
    DocumentSymbolResult,
    EditorPosition,
    EditorRange,
    FixableDiagnostic,
    HoverResult,
    PrepareRenameResult,
    QuickFix,
    ReferenceResult,
    RenameResult,
    SemanticToken,
    SemanticTokenModifier,
    SemanticTokenType,
    SignatureHelpResult,
    SymbolKind,
    TextEdit
} from './types.js';
