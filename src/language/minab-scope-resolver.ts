/**
 * Resolution for Minab's scope-stack sigils (spec §2.2): `.`, `^`, `#alias`,
 * `KEY`, plus bare-name lookups (`NameRef`) for `let`/params/loop
 * variables and join/query aliases used without `#`.
 *
 * This is *not* a Langium `ScopeProvider` wired into the Linker — nothing
 * in `minab.langium` uses cross-reference (`[Type:ID]`) syntax, so the
 * Linker never calls `getScope` in the first place. Table/column names
 * come from a host-supplied `SchemaProvider` (see `schema.ts`), not from
 * in-file declarations, which don't exist for tables at all. Instead this
 * is a plain resolution service: given a sigil/name node, it walks that
 * node's AST ancestor chain to reconstruct the §2.2 scope stack and
 * answers "what does this refer to here?" Turning an unresolved answer
 * into a user-facing diagnostic is Phase 3's job (the `Validator`), not
 * this one's.
 *
 * Resolution here is deliberately bounded to what's *structurally*
 * knowable without a type system: one hop of member access off a sigil
 * whose table is directly known (a bare table name, a `#alias`/alias
 * naming a table or another alias, a join alias). A chain like
 * `.customer.country` fails at the second hop with an explicit
 * "requires Phase 4" reason rather than guessing — see `resolveColumn`.
 */

import type { AstNode } from 'langium';
import {
    isBlock,
    isFilterAccess,
    isFunctionDecl,
    isLoopStatement,
    isMemberAccess,
    isModel,
    isNamedScope,
    isNameRef,
    isCurrentRecord,
    isParentRecord,
    isQuery,
    isTableRef,
    isVariableDecl,
    type CurrentRecord,
    type Expression,
    type GroupKeyRef,
    type MemberAccess,
    type NamedScope,
    type NameRef,
    type ParentRecord,
    type TableRef,
    type VariableDecl
} from './generated/ast.js';
import { coded, type CodedMessage } from './diagnostics/codes.js';
import { DEFAULT_RULE_CONTEXT, type MinabRuleContext, type SchemaProvider } from './schema.js';

export interface ResolvedScope {
    /** The AST node that establishes this scope/declaration (a Query, JoinClause, FilterAccess, LoopStatement, VariableDecl, Param, or — for a schema-external table — the referencing node itself). */
    owner: AstNode;
    /** The table this scope's rows come from, when statically known. Absent when it would require the Phase 4 type system to determine (e.g. traversal through a relation column). */
    tableName?: string;
}

export type ScopeResolution = { found: true; scope: ResolvedScope } | ({ found: false } & CodedMessage);

interface AliasEntry {
    node: AstNode;
    tableName?: string;
}

interface ScopeLevel {
    owner: AstNode;
    aliases: Map<string, AliasEntry>;
    tableName?: string;
}

interface RawLevelAliasDef {
    name: string;
    node: AstNode;
    tableName?: string;
}

interface RawLevel {
    owner: AstNode;
    receiver: Expression | undefined;
    aliasDefs: RawLevelAliasDef[];
}

export class MinabScopeResolver {
    constructor(
        private readonly schema: SchemaProvider,
        private readonly ruleContext: MinabRuleContext = DEFAULT_RULE_CONTEXT
    ) {}

    resolveCurrentRecord(node: CurrentRecord): ScopeResolution {
        const stack = this.stackAt(node);
        if (stack.length === 0) {
            return { found: false, ...coded('scope.noActiveScope') };
        }
        const level = stack[0];
        if (!node.field) {
            return { found: true, scope: { owner: level.owner, tableName: level.tableName } };
        }
        return this.resolveColumn(level.tableName, node.field, node);
    }

    /**
     * The innermost scope level's own `{owner, tableName}`, ignoring any
     * `.field` on `node` — i.e. what bare `.` means at `node`'s position,
     * regardless of whether `node` itself is a field access. Exposed for
     * the Phase 4 type checker, which needs the *type* of a `.field`
     * column (not just whether it exists, which is all `resolveColumn`
     * exposes) and so does its own `SchemaProvider` lookup instead of
     * going through `resolveColumn`.
     */
    resolveCurrentRecordBase(node: AstNode): ScopeResolution {
        const stack = this.stackAt(node);
        if (stack.length === 0) {
            return { found: false, ...coded('scope.noActiveScope') };
        }
        const level = stack[0];
        return { found: true, scope: { owner: level.owner, tableName: level.tableName } };
    }

    resolveParentRecord(node: ParentRecord): ScopeResolution {
        const stack = this.stackAt(node);
        if (stack.length < 2) {
            return { found: false, ...coded('scope.noParentScope') };
        }
        const level = stack[1];
        return { found: true, scope: { owner: level.owner, tableName: level.tableName } };
    }

    resolveNamedScope(node: NamedScope): ScopeResolution {
        const stack = this.stackAt(node);
        for (const level of stack) {
            const entry = level.aliases.get(node.name);
            if (entry) {
                return { found: true, scope: { owner: entry.node, tableName: entry.tableName } };
            }
        }
        const table = this.schema.getTable(node.name);
        if (table) {
            return { found: true, scope: { owner: node, tableName: table.name } };
        }
        return { found: false, ...coded('scope.unknownAlias', { name: node.name }) };
    }

    resolveGroupKeyRef(node: GroupKeyRef): ScopeResolution {
        let child: AstNode = node;
        let current: AstNode | undefined = node.$container;
        while (current) {
            if (isQuery(current)) {
                if (!current.groupByClause) {
                    return { found: false, ...coded('scope.keyWithoutGroupBy') };
                }
                const validField =
                    current.havingClause === child || current.selectClause === child || current.orderByClause === child || current.limitClause === child;
                if (!validField) {
                    return { found: false, ...coded('scope.keyInWrongClause') };
                }
                return { found: true, scope: { owner: current.groupByClause } };
            }
            child = current;
            current = current.$container;
        }
        return { found: false, ...coded('scope.keyOutsideQuery') };
    }

    resolveNameRef(node: NameRef): ScopeResolution {
        const stack = this.stackAt(node);
        for (const level of stack) {
            const entry = level.aliases.get(node.name);
            if (entry) {
                return { found: true, scope: { owner: entry.node, tableName: entry.tableName } };
            }
        }
        const decl = this.lexicalLookup(node, node.name);
        if (decl) {
            return { found: true, scope: { owner: decl } };
        }
        return { found: false, ...coded('scope.unknownName', { name: node.name }) };
    }

    resolveMemberAccess(node: MemberAccess): ScopeResolution {
        const base = this.resolveExpressionAsScope(node.receiver);
        if (!base.found) {
            return base;
        }
        return this.resolveColumn(base.scope.tableName, node.member, node);
    }

    resolveTableRef(node: TableRef): ScopeResolution {
        const table = this.schema.getTable(node.name);
        if (!table) {
            return { found: false, ...coded('scope.unknownTable', { name: node.name }) };
        }
        return { found: true, scope: { owner: node, tableName: table.name } };
    }

    private resolveExpressionAsScope(expr: Expression): ScopeResolution {
        if (isCurrentRecord(expr)) return this.resolveCurrentRecord(expr);
        if (isParentRecord(expr)) return this.resolveParentRecord(expr);
        if (isNamedScope(expr)) return this.resolveNamedScope(expr);
        if (isNameRef(expr)) return this.resolveNameRef(expr);
        if (isMemberAccess(expr)) return this.resolveMemberAccess(expr);
        return { found: false, ...coded('scope.computedReceiver') };
    }

    private resolveColumn(tableName: string | undefined, field: string, node: AstNode): ScopeResolution {
        if (!tableName) {
            return { found: false, ...coded('scope.columnNeedsTable', { column: field }) };
        }
        if (!this.schema.getColumn(tableName, field)) {
            return { found: false, ...coded('scope.unknownColumn', { column: field, table: tableName }) };
        }
        return { found: true, scope: { owner: node, tableName: undefined } };
    }

    /**
     * Builds the spec §2.2 scope stack visible at `node`, ordered innermost
     * first (`stack[0]` is what `.` means; `stack[1]` is what `^` means).
     *
     * Pushed by: entering a `Query`'s clauses (but not its own `source`),
     * a `[...]` filter's condition (but not its own `receiver`), and a
     * `for-in` loop's body/guard (but not its own `iterable`) — mirroring
     * spec §2.2's push list. `#Table` and joins don't add stack depth on
     * their own; they register as named entries on the level that opens
     * them (see `aliasDefs` below), matching "`#Table` ... pushes that
     * table's row scope, without affecting `.`".
     */
    private stackAt(node: AstNode): ScopeLevel[] {
        const raw: RawLevel[] = [];
        let child: AstNode = node;
        let current: AstNode | undefined = node.$container;
        while (current) {
            if (isQuery(current) && current.source !== child) {
                raw.push({
                    owner: current,
                    receiver: current.source,
                    aliasDefs: [
                        ...(current.alias ? [{ name: current.alias, node: current as AstNode }] : []),
                        ...current.joins.map(j => ({ name: j.alias, node: j as AstNode, tableName: j.source }))
                    ]
                });
            } else if (isFilterAccess(current) && current.receiver !== child) {
                raw.push({ owner: current, receiver: current.receiver, aliasDefs: [] });
            } else if (isLoopStatement(current) && current.iterable && current.iterable !== child) {
                raw.push({
                    owner: current,
                    receiver: current.iterable,
                    aliasDefs: current.variable ? [{ name: current.variable, node: current as AstNode }] : []
                });
            }
            child = current;
            current = current.$container;
        }
        // `child` is now the document root (Model). A bare top-level
        // expression is a record-/field-level rule (spec §6) — its `.`
        // is "the record under validation," bound by the host at
        // evaluation time, not declared anywhere in-file. Register it as
        // an implicit outermost level so `^` inside e.g. the §6.1
        // `#Booking[... ^...]` pattern (no enclosing FROM at all) still
        // reaches *something*. Its table is the host's `recordTable`, or
        // unknown when the host gave none. This is deliberately permissive — whether `.`/`^` are legal in a given
        // position at all is Phase 3's (the Validator's) job, not this
        // one's.
        const root: ScopeLevel = { owner: child, tableName: this.rootTable(), aliases: new Map() };

        // `raw` is innermost-first. A receiver can only refer to an outer
        // scope (e.g. `FROM .orders`, or a bare alias from further out), so
        // resolve outermost-first, accumulating levels as we go.
        const outerToInner: ScopeLevel[] = [root];
        for (let i = raw.length - 1; i >= 0; i--) {
            const r = raw[i];
            const tableName = this.receiverTableName(r.receiver, outerToInner);
            const aliases = new Map<string, AliasEntry>();
            for (const def of r.aliasDefs) {
                aliases.set(def.name, {
                    node: def.node,
                    tableName: def.tableName ?? (def.node === r.owner ? tableName : undefined)
                });
            }
            outerToInner.push({ owner: r.owner, tableName, aliases });
        }
        return outerToInner.reverse();
    }

    /** The table of the record under validation (spec §6), when the host named one and the schema has it. */
    private rootTable(): string | undefined {
        const name = this.ruleContext.recordTable;
        return name === undefined ? undefined : this.schema.getTable(name)?.name;
    }

    private receiverTableName(receiver: Expression | undefined, outerLevels: ScopeLevel[]): string | undefined {
        if (!receiver) {
            return undefined;
        }
        if (isTableRef(receiver)) {
            return this.schema.getTable(receiver.name)?.name;
        }
        if (isNamedScope(receiver)) {
            // `outerLevels` is ordered outer-to-inner; scan innermost-first
            // so a nearer alias shadows a same-named one further out.
            for (let i = outerLevels.length - 1; i >= 0; i--) {
                const entry = outerLevels[i].aliases.get(receiver.name);
                if (entry) return entry.tableName;
            }
            return this.schema.getTable(receiver.name)?.name;
        }
        if (isNameRef(receiver)) {
            for (let i = outerLevels.length - 1; i >= 0; i--) {
                const entry = outerLevels[i].aliases.get(receiver.name);
                if (entry) return entry.tableName;
            }
            return undefined;
        }
        // CurrentRecord (`FROM .field`) and MemberAccess (`FROM .a.b`) — a
        // relation traversal chain, now resolvable (Phase 4): walk to the
        // chain's own base table via the ordinary sigil-resolution methods
        // below, then follow the schema's `ref`/`collection` column to its
        // target table. Safe to call here — those methods recompute the
        // scope stack fresh from the receiver's own AST position, which
        // sits *outside* (an ancestor of) the level currently being built,
        // so this can't re-enter the same level. Subquery and other
        // computed receivers still fall through to `undefined`.
        return this.tableOfExpression(receiver);
    }

    private tableOfExpression(expr: Expression): string | undefined {
        if (isCurrentRecord(expr)) {
            const base = this.resolveCurrentRecordBase(expr);
            if (!base.found || !base.scope.tableName) return undefined;
            return expr.field ? this.followRelationColumn(base.scope.tableName, expr.field) : base.scope.tableName;
        }
        if (isParentRecord(expr)) {
            const res = this.resolveParentRecord(expr);
            return res.found ? res.scope.tableName : undefined;
        }
        if (isNamedScope(expr)) {
            const res = this.resolveNamedScope(expr);
            return res.found ? res.scope.tableName : undefined;
        }
        if (isNameRef(expr)) {
            const res = this.resolveNameRef(expr);
            return res.found ? res.scope.tableName : undefined;
        }
        if (isMemberAccess(expr)) {
            const receiverTable = this.tableOfExpression(expr.receiver);
            return receiverTable ? this.followRelationColumn(receiverTable, expr.member) : undefined;
        }
        return undefined;
    }

    /** A schema `ref`/`collection` column's target table — `undefined` for a scalar column, an unknown column, or an unknown table. */
    private followRelationColumn(table: string, field: string): string | undefined {
        const col = this.schema.getColumn(table, field);
        return col && col.type.kind !== 'scalar' ? col.type.table : undefined;
    }

    /** Ordinary lexical lookup for `let`/params/loop variables — these are real in-file declarations, unlike table/column names. */
    private lexicalLookup(node: AstNode, name: string): AstNode | undefined {
        let child: AstNode = node;
        let current: AstNode | undefined = node.$container;
        while (current) {
            if (
                isLoopStatement(current) &&
                current.variable === name &&
                current.lowerBound !== child &&
                current.upperBound !== child &&
                current.iterable !== child &&
                current.condition !== child
            ) {
                return current;
            }
            if (isFunctionDecl(current)) {
                const param = current.params.find(p => p.name === name);
                if (param) return param;
            }
            const owningArray = isBlock(current)
                ? current.statements
                : isFunctionDecl(current)
                  ? current.body
                  : isLoopStatement(current)
                    ? current.statements
                    : isModel(current)
                      ? current.declarations
                      : undefined;
            if (owningArray) {
                const decl = owningArray.find((s): s is VariableDecl => isVariableDecl(s) && s.name === name);
                if (decl) return decl;
            }
            child = current;
            current = current.$container;
        }
        return undefined;
    }
}
