/**
 * Program analysis (ADR 0002, section 7): what a prepared program touches,
 * found from the AST before it runs. It reads the AST and the schema only. It
 * never runs the program and never changes the interpreter.
 *
 * The rule is conservative. When the analysis cannot be sure that a program
 * needs no data, it says `needsData` and tier `data`. A wrong `data` costs a
 * network call. A wrong `local` would give a wrong answer. See the README.
 */

import { AstUtils, type AstNode } from 'langium';
import {
    isAssignmentStatement,
    isCallExpression,
    isCurrentRecord,
    isDeleteStatement,
    isFieldValue,
    isFilterAccess,
    isFunctionDecl,
    isInsertStatement,
    isJoinClause,
    isJsonProperty,
    isLoopStatement,
    isMemberAccess,
    isNamedScope,
    isNameRef,
    isParentRecord,
    isQuery,
    isSubquery,
    isTableRef,
    isTupleAccess,
    isUpdateStatement,
    isVariableDecl,
    type FunctionDecl,
    type Model,
    type Query
} from '../language/generated/ast.js';
import { isBuiltinName } from '../language/minab-builtins.js';
import type { SchemaProvider } from '../language/schema.js';
import type { ProgramAnalysis } from './types.js';

export interface AnalyzeOptions {
    /** Host functions marked `local`: they run in the browser and need no data. */
    localHostFunctions?: ReadonlySet<string>;
}

/** Where names and `.` point at one place in the program. */
interface Scope {
    /** The table `.` reads from, when known. */
    table: string | undefined;
    /** True for the record under validation, false for a row (a query, a filter). */
    record: boolean;
    /** The scope `^` points at. */
    outer: Scope | undefined;
    /** Local names (variables, parameters, loop variables) and table aliases (name → table). */
    names: Map<string, string | undefined>;
    /** A function body does not see the caller's local names. */
    barrier?: boolean;
}

function lookup(scope: Scope | undefined, name: string): { found: boolean; table?: string } {
    for (let s = scope; s; s = s.outer) {
        if (s.names.has(name)) return { found: true, table: s.names.get(name) };
        if (s.barrier) break;
    }
    return { found: false };
}

class Analyzer {
    readonly tables = new Set<string>();
    readonly recordFields = new Set<string>();
    readonly foreignKeys = new Set<string>();
    readonly inputs = new Set<string>();
    readonly hostFunctions = new Set<string>();
    readonly userFunctions = new Set<string>();
    readonly builtins = new Set<string>();
    readsFieldValue = false;
    readsWholeRecord = false;
    needsData = false;
    writes = false;

    private readonly declared = new Map<string, FunctionDecl>();
    private readonly active = new Set<string>();

    constructor(
        private readonly schema: SchemaProvider,
        private readonly options: AnalyzeOptions
    ) {}

    run(model: Model, recordTable: string | undefined): void {
        for (const d of model.declarations) if (isFunctionDecl(d)) this.declared.set(d.name, d);
        const root: Scope = { table: recordTable, record: true, outer: undefined, names: new Map() };
        for (const d of model.declarations) if (!isFunctionDecl(d)) this.visit(d, root);
        if (model.tail) this.visit(model.tail, root);
    }

    private table(name: string): string {
        const found = this.schema.getTable(name)?.name ?? name;
        this.tables.add(found);
        return found;
    }

    /** A relation column reads another table: the program needs data. */
    private relation(table: string | undefined, field: string): string | undefined {
        if (!table) return undefined;
        const column = this.schema.getColumn(table, field);
        if (!column || column.type.kind === 'scalar') return undefined;
        this.needsData = true;
        if (column.type.kind === 'ref' && column.type.foreignKey) this.foreignKeys.add(column.type.foreignKey);
        return this.table(column.type.table);
    }

    /** A field of the record under validation, or of a row. */
    private field(scope: Scope | undefined, field: string): void {
        if (!scope) {
            this.needsData = true;
            return;
        }
        if (scope.record) {
            this.recordFields.add(field);
            if (!scope.table) this.needsData = true;
        }
        this.relation(scope.table, field);
    }

    /** The table a receiver's rows come from, when it can be told from the tree. */
    private tableOf(expr: AstNode, scope: Scope): string | undefined {
        if (isCurrentRecord(expr)) {
            if (!expr.field) return scope.table;
            const column = scope.table ? this.schema.getColumn(scope.table, expr.field) : undefined;
            return column && column.type.kind !== 'scalar' ? column.type.table : undefined;
        }
        if (isParentRecord(expr)) return scope.outer?.table;
        if (isNamedScope(expr) || isTableRef(expr)) return this.schema.getTable(expr.name)?.name ?? expr.name;
        if (isNameRef(expr)) return lookup(scope, expr.name).table;
        if (isFilterAccess(expr)) return this.tableOf(expr.receiver, scope);
        if (isMemberAccess(expr)) {
            const table = this.tableOf(expr.receiver, scope);
            const column = table ? this.schema.getColumn(table, expr.member) : undefined;
            return column && column.type.kind !== 'scalar' ? column.type.table : undefined;
        }
        return undefined;
    }

    private children(node: AstNode, scope: Scope): void {
        for (const child of AstUtils.streamContents(node)) this.visit(child, scope);
    }

    private visit(node: AstNode, scope: Scope): void {
        if (isCurrentRecord(node)) {
            if (node.field) this.field(scope, node.field);
            else if (scope.record) this.readsWholeRecord = true;
            return;
        }
        if (isParentRecord(node)) {
            if (!scope.outer) this.needsData = true;
            else if (scope.outer.record) this.readsWholeRecord = true;
            return;
        }
        if (isFieldValue(node)) {
            this.readsFieldValue = true;
            return;
        }
        if (isNamedScope(node) || isTableRef(node)) {
            this.needsData = true;
            this.table(node.name);
            return;
        }
        if (isNameRef(node)) {
            if (!lookup(scope, node.name).found) this.inputs.add(node.name);
            return;
        }
        if (isJsonProperty(node)) {
            if (node.value) this.visit(node.value, scope);
            else if (!lookup(scope, node.key).found) this.inputs.add(node.key);
            return;
        }
        if (isMemberAccess(node)) {
            const receiver = node.receiver;
            if (isCurrentRecord(receiver) && !receiver.field) this.field(scope, node.member);
            else if (isParentRecord(receiver)) this.field(scope.outer, node.member);
            else {
                this.visit(receiver, scope);
                this.relation(this.tableOf(receiver, scope), node.member);
            }
            return;
        }
        if (isFilterAccess(node)) {
            this.visit(node.receiver, scope);
            const row: Scope = { table: this.tableOf(node.receiver, scope), record: false, outer: scope, names: new Map() };
            this.visit(node.filter, row);
            return;
        }
        if (isTupleAccess(node)) {
            this.visit(node.receiver, scope);
            return;
        }
        if (isCallExpression(node)) {
            this.call(node, scope);
            return;
        }
        if (isQuery(node)) {
            this.query(node, scope);
            return;
        }
        if (isSubquery(node)) {
            this.visit(node.query, scope);
            return;
        }
        if (isVariableDecl(node)) {
            if (node.value) this.visit(node.value, scope);
            scope.names.set(node.name, undefined);
            return;
        }
        if (isAssignmentStatement(node)) {
            let root: AstNode = node.target;
            while (isMemberAccess(root) || isTupleAccess(root) || isFilterAccess(root)) root = root.receiver;
            if (!(isNameRef(root) && lookup(scope, root.name).found)) this.writes = true;
            if (node.operator !== '=') this.visit(node.target, scope);
            this.visit(node.value, scope);
            return;
        }
        if (isInsertStatement(node)) {
            this.writes = true;
            this.needsData = true;
            this.visit(node.target, scope);
            this.visit(node.payload, scope);
            return;
        }
        if (isDeleteStatement(node) || isUpdateStatement(node)) {
            this.writes = true;
            this.needsData = true;
            this.visit(node.target, scope);
            const row: Scope = { table: this.tableOf(node.target, scope), record: false, outer: scope, names: new Map() };
            for (const child of AstUtils.streamContents(node)) if (child !== node.target) this.visit(child, row);
            return;
        }
        if (isLoopStatement(node)) {
            if (node.variable) scope.names.set(node.variable, undefined);
            this.children(node, scope);
            return;
        }
        this.children(node, scope);
    }

    private call(node: AstNode & { callee: AstNode; args: AstNode[] }, scope: Scope): void {
        const callee = node.callee;
        if (!isNameRef(callee)) {
            this.needsData = true;
            this.children(node, scope);
            return;
        }
        const name = callee.name;
        for (const arg of node.args) this.visit(arg, scope);
        if (isBuiltinName(name)) {
            this.builtins.add(name);
            return;
        }
        const declaration = this.declared.get(name);
        if (declaration) {
            this.userFunctions.add(name);
            // A call inside its own body adds nothing new.
            if (this.active.has(name)) return;
            this.active.add(name);
            const names = new Map<string, string | undefined>();
            for (const param of declaration.params) names.set(param.name, undefined);
            const inner: Scope = { table: scope.table, record: scope.record, outer: scope.outer, names, barrier: true };
            for (const statement of declaration.body) this.visit(statement, inner);
            if (declaration.tail) this.visit(declaration.tail, inner);
            this.active.delete(name);
            return;
        }
        this.hostFunctions.add(name);
        if (!this.options.localHostFunctions?.has(name)) this.needsData = true;
    }

    private query(query: Query, outer: Scope): void {
        this.needsData = true;
        const source = query.source;
        this.visit(source, outer);
        const table = this.tableOf(source, outer);
        const names = new Map<string, string | undefined>();
        if (query.alias) names.set(query.alias, table);
        const scope: Scope = { table, record: false, outer, names };
        for (const child of AstUtils.streamContents(query)) {
            if (child === source) continue;
            if (isJoinClause(child)) names.set(child.alias, this.table(child.source));
        }
        for (const child of AstUtils.streamContents(query)) {
            if (child !== source) this.visit(child, scope);
        }
    }
}

const sorted = (set: Set<string>): string[] => [...set].sort();

/** The answer when nothing can be proved: needs data, may write. */
export function conservativeAnalysis(): ProgramAnalysis {
    return {
        tables: [],
        recordFields: [],
        dependencies: [],
        readsWholeRecord: true,
        readsFieldValue: true,
        inputs: [],
        hostFunctions: [],
        userFunctions: [],
        builtins: [],
        needsData: true,
        writes: true,
        tier: 'data'
    };
}

export function analyzeProgram(model: Model, schema: SchemaProvider, recordTable: string | undefined, options: AnalyzeOptions = {}): ProgramAnalysis {
    try {
        const analyzer = new Analyzer(schema, options);
        analyzer.run(model, recordTable);
        const recordFields = sorted(analyzer.recordFields);
        return {
            tables: sorted(analyzer.tables),
            recordFields,
            dependencies: sorted(new Set([...recordFields, ...analyzer.foreignKeys])),
            readsWholeRecord: analyzer.readsWholeRecord,
            readsFieldValue: analyzer.readsFieldValue,
            inputs: sorted(analyzer.inputs),
            hostFunctions: sorted(analyzer.hostFunctions),
            userFunctions: sorted(analyzer.userFunctions),
            builtins: sorted(analyzer.builtins),
            needsData: analyzer.needsData,
            writes: analyzer.writes,
            tier: analyzer.needsData || analyzer.writes ? 'data' : 'local'
        };
    } catch {
        // An odd tree: say the safe thing.
        return conservativeAnalysis();
    }
}

/** Does a change of this record field change the result? Always true when the program reads the whole record. */
export function dependsOnField(analysis: ProgramAnalysis, field: string): boolean {
    return analysis.readsWholeRecord || analysis.dependencies.includes(field);
}
