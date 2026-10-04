/** Editor services: completion, hover, go to definition and signature help. No Node, DOM, LSP or Monaco types. */

export { complete } from './complete.js';
export { definition } from './definition.js';
export { parseDocument, type EditorDocument } from './document.js';
export { hover, typeOf } from './hover.js';
export { signatureHelp } from './signature-help.js';
export { BUILTIN_DOCS } from './builtin-docs.js';
export type {
    CompletionItem,
    CompletionKind,
    CompletionResult,
    DefinitionResult,
    EditorPosition,
    EditorRange,
    HoverResult,
    SignatureHelpResult
} from './types.js';
