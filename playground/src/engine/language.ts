/**
 * The language side of one host, hosted in the worker.
 *
 * Checking, compiling and running go through the runtime API (`Minab`, one
 * per host, from `src/runtime/`). That is all `engine.ts` needs for them.
 *
 * `LanguageHost` is what is left of the old direct use of Langium. It parses a
 * program into a syntax tree for the three things the runtime does not give
 * yet: editor intelligence (`intel.ts`, moves with E1), the list of
 * "check-only" constructs with their ranges, and the declared symbols. It
 * does not check or run anything.
 *
 * `createMinabServices` bakes the schema and rule context into the services
 * it builds, so each distinct host gets its own service set. Building one
 * costs ~80 ms in production mode, and hosts change rarely — on example
 * switches and schema edits — so both caches key on the config.
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
import { createMinab, type Minab } from '../../../src/runtime/index.js';

export type Channel = 'analyze' | 'run' | 'intel' | 'probe';

export class LanguageHost {
    readonly services: MinabServices;
    private readonly shared: ReturnType<typeof createMinabServices>['shared'];

    constructor(
        readonly schema: MinabSchema,
        readonly ruleContext: MinabRuleContext
    ) {
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
}

/**
 * The playground's limits for a run. The runtime defaults apply, except the wall time: it also
 * counts the first query, which waits for the in-browser Postgres to boot.
 */
const RUN_LIMITS = { wallTimeMs: 10_000 };

/** One host as the engine uses it: the runtime for the work, the syntax tree for the editor. */
export interface HostLanguage {
    minab: Minab;
    language: LanguageHost;
}

/** Caches one `Minab` and one `LanguageHost` per distinct schema + rule context. */
export class LanguageHosts {
    private readonly cache = new Map<string, HostLanguage>();

    get(schema: MinabSchema, ruleContext: MinabRuleContext): HostLanguage {
        const key = JSON.stringify([schema, ruleContext]);
        let host = this.cache.get(key);
        if (!host) {
            host = {
                minab: createMinab({ schema, ruleContext, limits: RUN_LIMITS, mode: 'production' }),
                language: new LanguageHost(schema, ruleContext)
            };
            // A handful of hosts is all a session visits; keep the most recent few.
            if (this.cache.size >= 6) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(key, host);
        }
        return host;
    }
}
