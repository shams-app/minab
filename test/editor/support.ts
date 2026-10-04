import { EmptyFileSystem, URI } from 'langium';
import { parseDocument, type EditorDocument, type EditorRange } from '../../src/editor/index.js';
import { resolveHostDeclarations } from '../../src/language/host-declarations.js';
import { createMinabServices } from '../../src/language/minab-module.js';
import { scalarType, type MinabRuleContext, type MinabSchema } from '../../src/language/schema.js';

const scalar = (base: Parameters<typeof scalarType>[0], nullable = false) => ({
    kind: 'scalar' as const,
    type: scalarType(base, { nullable })
});

/** `Order` and `Customer`, with a relation each way, a column with a Persian name and a column with a different SQL name. */
export const schema: MinabSchema = {
    version: 'editor-tests',
    tables: [
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'total', type: scalar('DECIMAL') },
                { name: 'status', type: scalar('TEXT') },
                { name: 'مبلغ', type: scalar('DECIMAL'), sqlName: 'amount_fa' },
                { name: 'customer_id', type: scalar('UUID', true) },
                {
                    name: 'customer',
                    type: {
                        kind: 'ref',
                        table: 'Customer',
                        nullable: true,
                        foreignKey: 'customer_id'
                    }
                }
            ]
        },
        {
            name: 'Customer',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'name', type: scalar('TEXT') },
                { name: 'country', type: scalar('TEXT') },
                {
                    name: 'orders',
                    type: {
                        kind: 'collection',
                        table: 'Order',
                        foreignKey: 'customer_id'
                    }
                }
            ]
        }
    ]
};

export interface SetupOptions {
    rule?: MinabRuleContext;
    host?: boolean;
}

/** The services of one host. `host: true` declares the function `fxRate` and the inputs `currentUser` and `limit`. */
export function setup(options: SetupOptions = {}) {
    const host = options.host
        ? resolveHostDeclarations(
              {
                  functions: [
                      {
                          name: 'fxRate',
                          params: [
                              { name: 'from', type: 'TEXT' },
                              { name: 'to', type: 'TEXT' }
                          ],
                          returns: 'DECIMAL',
                          local: true
                      }
                  ],
                  inputs: {
                      currentUser: { id: 'TEXT', name: 'TEXT' },
                      limit: 'INTEGER'
                  }
              },
              schema
          )
        : undefined;
    const { Minab } = createMinabServices(EmptyFileSystem, schema, options.rule, {
        mode: 'production',
        host
    });
    return Minab;
}

/** `source` with one `|` for the cursor: gives the text without it and the offset. */
export function cursor(marked: string): { source: string; offset: number } {
    const offset = marked.indexOf('|');
    if (offset < 0 || marked.indexOf('|', offset + 1) >= 0) throw new Error('A test source needs exactly one "|".');
    return { source: marked.slice(0, offset) + marked.slice(offset + 1), offset };
}

export function open(services: ReturnType<typeof setup>, source: string): EditorDocument {
    return parseDocument(services, source);
}

let checked = 0;

/** The diagnostics of `source`, built like the language server builds them (a syntax error stops the check). */
export async function diagnose(services: ReturnType<typeof setup>, source: string) {
    const { workspace } = services.shared;
    const uri = URI.parse(`inmemory:///diagnose-${checked++}.minab`);
    const document = workspace.LangiumDocumentFactory.fromString(source, uri);
    workspace.LangiumDocuments.addDocument(document);
    try {
        await workspace.DocumentBuilder.build([document], { validation: { stopAfterLexingErrors: true, stopAfterParsingErrors: true } });
        return document.diagnostics ?? [];
    } finally {
        workspace.LangiumDocuments.deleteDocument(uri);
    }
}

/** `source` with the edits applied. */
export function applyEdits(source: string, edits: { range: EditorRange; newText: string }[]): string {
    const lines = source.split('\n');
    const offsetOf = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
    return [...edits]
        .sort((a, b) => offsetOf(b.range.start) - offsetOf(a.range.start))
        .reduce((text, e) => text.slice(0, offsetOf(e.range.start)) + e.newText + text.slice(offsetOf(e.range.end)), source);
}
