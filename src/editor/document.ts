/**
 * What every editor function reads: the language services of one host and one
 * parsed document. The functions never change the document or the workspace.
 */

import { URI, type LangiumDocument } from 'langium';
import type { Model } from '../language/generated/ast.js';
import type { MinabServices } from '../language/minab-module.js';
import type { EditorPosition, EditorRange } from './types.js';

export interface EditorDocument {
    services: MinabServices;
    document: LangiumDocument<Model>;
}

let counter = 0;

/**
 * Parses `source` into a document that lives nowhere but in the returned
 * value: it is not added to the workspace, so there is nothing to clean up.
 * It does not check the program.
 */
export function parseDocument(services: MinabServices, source: string): EditorDocument {
    const uri = URI.parse(`inmemory:///editor-${counter++}.minab`);
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<Model>(source, uri);
    return { services, document };
}

export function sourceOf(doc: EditorDocument): string {
    return doc.document.textDocument.getText();
}

export function positionAt(source: string, offset: number): EditorPosition {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset && i < source.length; i++) {
        if (source.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, character: offset - lineStart };
}

export function rangeOfNode(node: { $cstNode?: { range: EditorRange } }): EditorRange | undefined {
    return node.$cstNode?.range;
}
