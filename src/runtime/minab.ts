/**
 * `createMinab`: the entry of the runtime API (ADR 0002, section 3).
 *
 * Nothing here may touch Node or the DOM. `test/runtime-imports.test.ts`
 * checks the import graph.
 */

import { resolveHostDeclarations } from '../language/host-declarations.js';
import { DEFAULT_RULE_CONTEXT } from '../language/schema.js';
import { resolveLimits } from './limits.js';
import { LANGUAGE_VERSION, migrate } from './migrate.js';
import { prepareProgram, refusedByVersion } from './prepare.js';
import { DEFAULT_SERVICE_CACHE_SIZE, ServiceCache } from './service-cache.js';
import type { CacheStats, Minab, MinabOptions, PrepareOptions, PreparedProgram } from './types.js';

export function createMinab(options: MinabOptions): Minab {
    const cache = new ServiceCache(options.serviceCacheSize ?? DEFAULT_SERVICE_CACHE_SIZE, options.mode ?? 'production');
    // Checks the names and the type words now, so a host developer sees a mistake at startup.
    const host = resolveHostDeclarations({ functions: options.functions, inputs: options.inputs }, options.schema);
    // Checks the limits now too: a limit that is not a number above zero throws.
    const limits = resolveLimits(options.limits);
    const defaultContext = options.ruleContext ?? DEFAULT_RULE_CONTEXT;
    const localHostFunctions = new Set([...host.functions.values()].filter(f => f.local).map(f => f.name));
    let disposed = false;
    let counter = 0;

    return {
        async prepare(source: string, prepareOptions: PrepareOptions = {}): Promise<PreparedProgram> {
            if (disposed) throw new Error('this Minab runtime was disposed');
            if (typeof source !== 'string') throw new TypeError('prepare needs the program source as a string');
            const ruleContext = prepareOptions.ruleContext ?? defaultContext;
            const set = cache.get(options.schema, ruleContext, host);
            // One URI for each call: calls may overlap, and a shared URI would make them fight.
            const uri = `minab:///prepared/${counter++}.minab`;
            let text = source;
            const requested = prepareOptions.languageVersion ?? LANGUAGE_VERSION;
            if (!Number.isInteger(requested) || requested < 1) throw new TypeError('languageVersion must be a whole number of 1 or more');
            if (requested > LANGUAGE_VERSION) {
                return refusedByVersion(set, ruleContext.recordTable, limits, {
                    code: 'compat.newerLanguage',
                    params: { requested, supported: LANGUAGE_VERSION }
                });
            }
            if (requested < LANGUAGE_VERSION) {
                const migrated = migrate(source, requested, LANGUAGE_VERSION);
                if (!migrated.ok) {
                    return refusedByVersion(set, ruleContext.recordTable, limits, {
                        code: 'compat.noMigration',
                        params: { from: requested, to: LANGUAGE_VERSION }
                    });
                }
                text = migrated.source;
            }
            return prepareProgram(set, uri, text, prepareOptions.expect, ruleContext.recordTable, localHostFunctions, limits);
        },
        cacheStats(): CacheStats {
            return { size: cache.size, created: cache.created, hits: cache.hits, openDocuments: cache.openDocuments() };
        },
        dispose(): void {
            disposed = true;
            cache.clear();
        }
    };
}
