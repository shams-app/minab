import type { Module } from 'langium';
import type { DefaultSharedModuleContext, LangiumServices, LangiumSharedServices, PartialLangiumServices } from 'langium/lsp';
import { createDefaultModule, createDefaultSharedModule } from 'langium/lsp';
import { inject } from 'langium';
import { MinabGeneratedModule, MinabGeneratedSharedModule, MinabLanguageMetaData } from './generated/module.js';
import { MinabDefinitionProvider } from './lsp/minab-definition-provider.js';
import { MinabHoverProvider } from './lsp/minab-hover-provider.js';
import { MinabInterpreter } from './minab-interpreter.js';
import { MinabDocumentValidator } from './diagnostics/minab-document-validator.js';
import { MinabScopeResolver } from './minab-scope-resolver.js';
import { MinabSqlCompiler } from './minab-sql-compiler.js';
import { MinabTypeChecker } from './minab-type-checker.js';
import { registerValidationChecks } from './minab-validator.js';
import type { ResolvedHost } from './host-declarations.js';
import { DEFAULT_RULE_CONTEXT, EMPTY_SCHEMA, SchemaProvider, type MinabRuleContext, type MinabSchema } from './schema.js';

/**
 * Declaration of custom services for the Minab language.
 *
 *  - `schema`: the host-supplied table/column contract and the
 *    host's declared inputs and functions (see `schema.ts`, `host-declarations.ts`) — Minab has no in-file table declarations, so this is
 *    the only source of truth for what `#alias`/bare table names mean.
 *  - `scopeResolver`: resolves the scope-stack sigils (`.`/`^`/`#alias`/
 *    `KEY`, spec §2.2) plus bare `NameRef` lookups. Not a Langium
 *    `ScopeProvider` — see `minab-scope-resolver.ts` for why.
 *  - `ruleContext`: host-supplied fact about whether the program being
 *    validated is a field-level rule, and (Phase 4) `$`'s type when it is
 *    (see `schema.ts`) — consumed by the `Validator`'s `$`-placement check
 *    and by `typeChecker`.
 *  - `typeChecker`: type inference/checking (Phase 4, `minab-type-
 *    checker.ts`) over the expression grammar — no-implicit-coercion,
 *    the §3.4 collection-vs-scalar boundary, and the §7.7 null-operand
 *    rules, all enforced as validator checks that call `inferType`.
 *  - `sqlCompiler`/`interpreter`: the two halves of Phase 5's execution
 *    strategy (see `docs/adr/0001-execution-strategy.md`) — SQL for the
 *    relational layer, a tree-walking interpreter for everything else,
 *    with the interpreter pushing relational subexpressions down to the
 *    compiler. Both are stateless; the host's connection and the record
 *    under evaluation are passed per call, to `interpreter.evaluate`.
 *
 * The `Validator` (`minab-validator.ts`) checks: `$` only valid when
 * `ruleContext.isFieldRule`; `KEY` only valid after `GROUPBY`; `#alias`
 * referencing an undeclared table (Phase 3); plus the full set of
 * type-checking diagnostics built on `typeChecker` (Phase 4).
 *
 * Built on `langium/lsp`'s services (roadmap Phase 7), not the core-only
 * ones: `Minab` includes an `lsp` service group in addition to the ones
 * below, and `createMinabServices` works the same way for a one-shot CLI
 * invocation (`langium/node`'s `NodeFileSystem`, no `connection`) as it
 * does for a long-running language server (`src/language/main.ts`, which
 * passes a real `connection`). `MinabHoverProvider`/`MinabDefinitionProvider`
 * (`./lsp/`) override the LSP defaults for `#alias` (`NamedScope`), since
 * Minab has no Langium cross-references for the default reference-based
 * providers to key off — see `minab-scope-resolver.ts`.
 */
export type MinabAddedServices = {
    schema: SchemaProvider;
    scopeResolver: MinabScopeResolver;
    ruleContext: MinabRuleContext;
    typeChecker: MinabTypeChecker;
    sqlCompiler: MinabSqlCompiler;
    interpreter: MinabInterpreter;
};

/**
 * Union of Langium default (core + LSP) services and Minab-specific services.
 */
export type MinabServices = LangiumServices & MinabAddedServices;

/**
 * Per-embedding options that aren't language data.
 *
 * `mode` is Langium's own development/production distinction, and it is
 * worth more than it looks: in `development` (what `langium generate`
 * writes into `generated/module.ts`) Chevrotain re-validates the whole
 * grammar every time a parser is constructed and reports lookahead
 * ambiguities. That check belongs in grammar work — it's the safety net
 * `.cursor/rules/language-implementation.mdc` step 4 relies on, and the
 * test suite runs in `development` for exactly that reason — but it costs
 * ~2.8s per services instance against this grammar, measured, versus
 * ~80ms in `production`. An end-user entry point that creates services,
 * parses one file, and exits (the Phase 6 CLI) should not pay three
 * seconds for a check on a grammar the test suite already validated, so
 * it asks for `production` explicitly. Anything doing grammar work should
 * leave this alone.
 */
export interface MinabServiceOptions {
    mode?: 'development' | 'production';
    /** The host's declared inputs and functions (D27), resolved by `resolveHostDeclarations`. */
    host?: ResolvedHost;
}

/**
 * Dependency injection module that overrides Langium default services and
 * contributes the declared custom services. The Langium defaults can be
 * partially specified to override only distinct fields, while the
 * custom services must be fully specified.
 *
 * Takes the host-supplied schema and rule context as parameters (rather
 * than static exports) since both are genuinely per-embedding/per-document
 * data, not project constants.
 */
function createMinabModule(
    schema: MinabSchema,
    ruleContext: MinabRuleContext,
    options: MinabServiceOptions
): Module<MinabServices, PartialLangiumServices & MinabAddedServices> {
    return {
        ...(options.mode === 'production' ? { LanguageMetaData: () => ({ ...MinabLanguageMetaData, mode: 'production' as const }) } : {}),
        schema: () => new SchemaProvider(schema, options.host),
        scopeResolver: services => new MinabScopeResolver(services.schema, services.ruleContext.recordTable),
        ruleContext: () => ruleContext,
        typeChecker: services => new MinabTypeChecker(services.schema, services.scopeResolver, services.ruleContext),
        sqlCompiler: services => new MinabSqlCompiler(services.schema, services.typeChecker),
        interpreter: services => new MinabInterpreter(services.schema, services.sqlCompiler, services.typeChecker),
        validation: {
            DocumentValidator: services => new MinabDocumentValidator(services)
        },
        lsp: {
            HoverProvider: services => new MinabHoverProvider(services),
            DefinitionProvider: services => new MinabDefinitionProvider(services)
        }
    };
}

/**
 * Create the full set of services required by Langium.
 *
 * First inject the shared services by merging two modules:
 *  - Langium default shared services
 *  - Services generated by langium-cli
 *
 * Then inject the language-specific services by merging three modules:
 *  - Langium default language-specific services
 *  - Services generated by langium-cli
 *  - Services specified in this file
 *
 * `schema` is the host application's table/column/function contract (see
 * `schema.ts`); it defaults to empty for callers (e.g. the parsing smoke
 * suite) that don't need scope/schema resolution. `ruleContext` says
 * whether the program being validated is a field-level rule; it defaults
 * to `false` (record-level/general program). `options` carries anything
 * that isn't language data — today just the parser `mode`, which the CLI
 * sets to `production` for startup time; see `MinabServiceOptions`.
 */
export function createMinabServices(
    context: DefaultSharedModuleContext,
    schema: MinabSchema = EMPTY_SCHEMA,
    ruleContext: MinabRuleContext = DEFAULT_RULE_CONTEXT,
    options: MinabServiceOptions = {}
): {
    shared: LangiumSharedServices;
    Minab: MinabServices;
} {
    const shared = inject(createDefaultSharedModule(context), MinabGeneratedSharedModule);
    const Minab = inject(createDefaultModule({ shared }), MinabGeneratedModule, createMinabModule(schema, ruleContext, options));
    shared.ServiceRegistry.register(Minab);
    registerValidationChecks(Minab);
    return { shared, Minab };
}
