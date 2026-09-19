/**
 * Langium, hosted in the worker.
 *
 * `createMinabServices` bakes the schema and rule context into the
 * services it builds (the validator and type checker read them at
 * construction), so each distinct host gets its own service set. Building
 * one costs ~80 ms in production mode, and hosts change rarely — on
 * example switches and schema edits — so they're cached by config.
 *
 * Documents are parsed from strings under fixed in-memory URIs, one per
 * "channel" (the editor's analysis, a run, a completion probe), each
 * replaced wholesale on every request: programs are small and a fresh
 * parse is simpler than incremental updates.
 */

import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import type { Model } from '../../../src/language/generated/ast.js';
import { createMinabServices, type MinabServices } from '../../../src/language/minab-module.js';
import type { MinabRuleContext, MinabSchema } from '../../../src/language/schema.js';
import type { EngineDiagnostic, Severity } from './protocol.js';

export type Channel = 'analyze' | 'run' | 'intel' | 'probe';

export class LanguageHost {
    readonly services: MinabServices;
    private readonly shared: ReturnType<typeof createMinabServices>['shared'];

    constructor(readonly schema: MinabSchema, readonly ruleContext: MinabRuleContext) {
        const created = createMinabServices(EmptyFileSystem, schema, ruleContext, { mode: 'production' });
        this.services = created.Minab;
        this.shared = created.shared;
    }

    /** Parses `text` (without validating it) into a fresh document on the given channel. */
    async parse(text: string, channel: Channel): Promise<LangiumDocument<Model>> {
        const uri = URI.parse(`inmemory:///${channel}.minab`);
        const documents = this.shared.workspace.LangiumDocuments;
        if (documents.hasDocument(uri)) documents.deleteDocument(uri);
        const document = this.shared.workspace.LangiumDocumentFactory.fromString<Model>(text, uri);
        documents.addDocument(document);
        await this.shared.workspace.DocumentBuilder.build([document], { validation: false });
        return document;
    }

    /**
     * Runs Langium's validation — syntax errors, then Minab's validator and
     * type checker. It stops after syntax errors, as the CLI does: type
     * errors computed over a half-recovered tree mostly echo the typo that
     * caused them.
     */
    async validate(document: LangiumDocument<Model>): Promise<EngineDiagnostic[]> {
        const diagnostics = await this.services.validation.DocumentValidator.validateDocument(document, {
            stopAfterLexingErrors: true,
            stopAfterParsingErrors: true
        });
        document.diagnostics = diagnostics;
        return diagnosticsOf(document);
    }
}

export function diagnosticsOf(document: LangiumDocument): EngineDiagnostic[] {
    return (document.diagnostics ?? []).map(d => ({
        severity: (d.severity ?? 1) as Severity,
        message: typeof d.message === 'string' ? d.message : String(d.message),
        range: d.range,
        source: d.data && typeof d.data === 'object' && 'code' in d.data &&
            (d.data.code === 'lexing-error' || d.data.code === 'parsing-error')
            ? 'syntax'
            : 'minab'
    }));
}

/** Caches one `LanguageHost` per distinct schema + rule context. */
export class LanguageHosts {
    private readonly cache = new Map<string, LanguageHost>();

    get(schema: MinabSchema, ruleContext: MinabRuleContext): LanguageHost {
        const key = JSON.stringify([schema, ruleContext]);
        let host = this.cache.get(key);
        if (!host) {
            host = new LanguageHost(schema, ruleContext);
            // A handful of hosts is all a session visits; keep the most recent few.
            if (this.cache.size >= 6) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(key, host);
        }
        return host;
    }
}
