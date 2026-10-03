import { AstUtils, EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices, type MinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../src/language/schema.js';
import { isCurrentRecord, isGroupKeyRef, isMemberAccess, isNamedScope, isNameRef, isParentRecord, type Model } from '../src/language/generated/ast.js';

// Fixture schema standing in for the host application's real table/column
// contract (see src/language/schema.ts) — Minab itself never declares
// tables in-file.
const fixtureSchema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('INTEGER') } },
                { name: 'name', type: { kind: 'scalar', type: scalarType('TEXT') } }
            ]
        },
        {
            name: 'Customers',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('INTEGER') } },
                { name: 'balance', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'flagged', type: { kind: 'scalar', type: scalarType('BOOLEAN') } }
            ]
        },
        {
            name: 'Booking',
            columns: [
                { name: 'room_id', type: { kind: 'scalar', type: scalarType('INTEGER') } },
                { name: 'start_date', type: { kind: 'scalar', type: scalarType('DATE') } },
                { name: 'end_date', type: { kind: 'scalar', type: scalarType('DATE') } }
            ]
        },
        {
            name: 'Order',
            columns: [
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: false } },
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } }
            ]
        }
    ]
};

let parse: ReturnType<typeof parseHelper<Model>>;
let services: MinabServices;

beforeAll(async () => {
    const created = createMinabServices(EmptyFileSystem, fixtureSchema);
    services = created.Minab;
    parse = parseHelper<Model>(services);
});

async function parseModel(input: string): Promise<Model> {
    const doc = await parse(input);
    expect(doc.parseResult.parserErrors, doc.parseResult.parserErrors.map(e => e.message).join('\n')).toHaveLength(0);
    return doc.parseResult.value;
}

describe('CurrentRecord (`.`/`.field`)', () => {
    test('bare `.` in a FROM query resolves to the FROM table', async () => {
        // `.field` resolution (below) deliberately doesn't echo a table
        // name back — chaining a second `.field` off a column would
        // otherwise validate against the wrong table (the column's own
        // table, not whatever it points to) — so the level-identity check
        // needs a genuinely bare `.`, as it appears inside COUNT(.).
        const model = await parseModel(`FROM Customer SELECT COUNT(.) AS n`);
        const target = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && !n.field);
        expect(target).toBeDefined();
        const result = services.scopeResolver.resolveCurrentRecord(target! as never);
        expect(result.found).toBe(true);
        if (result.found) {
            expect(result.scope.tableName).toBe('Customer');
        }
    });

    test('resolves a plain `.field` in a FROM query to a real column', async () => {
        const model = await parseModel(`FROM Customer SELECT .name`);
        const target = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && n.field === 'name');
        expect(target).toBeDefined();
        const result = services.scopeResolver.resolveCurrentRecord(target! as never);
        expect(result.found).toBe(true);
    });

    test('reports an unknown column on a known table', async () => {
        const model = await parseModel(`FROM Customer SELECT .nonexistent_column`);
        const target = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && n.field === 'nonexistent_column');
        const result = services.scopeResolver.resolveCurrentRecord(target! as never);
        expect(result.found).toBe(false);
        if (!result.found) {
            expect(result.reason).toMatch(/unknown column/);
        }
    });
});

describe('the §6.1 correlated pattern — `#Booking[. != ^ ...]`', () => {
    const source = `
        .end_date > .start_date AND NOT EXISTS(
            #Booking[. != ^ AND .room_id == ^.room_id
                     AND .start_date < ^.end_date AND .end_date > ^.start_date]
        )
    `;

    test('bare `.` inside the filter (`. != ^`) resolves to the FilterAccess pushed by #Booking', async () => {
        const model = await parseModel(source);
        const bareDot = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && !n.field);
        expect(bareDot).toBeDefined();
        const dotResult = services.scopeResolver.resolveCurrentRecord(bareDot! as never);
        expect(dotResult.found).toBe(true);
        if (dotResult.found) {
            expect(dotResult.scope.tableName).toBe('Booking');
        }
    });

    test('`^` (`. != ^`) reaches back to the record under validation, one level below #Booking, not #Booking itself', async () => {
        const model = await parseModel(source);
        const bareDot = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && !n.field)!;
        const bareCaret = AstUtils.streamAst(model).find(n => isParentRecord(n))!;
        const dotLevel = services.scopeResolver.resolveCurrentRecord(bareDot as never);
        const caretLevel = services.scopeResolver.resolveParentRecord(bareCaret as never);
        expect(dotLevel.found).toBe(true);
        expect(caretLevel.found).toBe(true);
        if (dotLevel.found && caretLevel.found) {
            // `^` escaped the FilterAccess `.` belongs to...
            expect(caretLevel.scope.owner).not.toBe(dotLevel.scope.owner);
            // ...landing on the implicit "record under validation" scope,
            // whose table isn't statically known here (bound by the host
            // at evaluation time, per spec §6 — see minab-scope-resolver.ts).
            expect(caretLevel.scope.tableName).toBeUndefined();
        }

        // `^.room_id` therefore can't resolve a column yet either — not
        // because "no ^" but because the outer table isn't known without
        // the Phase 4 type system.
        const caretRoomId = AstUtils.streamAst(model).find(n => isMemberAccess(n) && n.member === 'room_id' && isParentRecord(n.receiver))!;
        const caretResult = services.scopeResolver.resolveMemberAccess(caretRoomId as never);
        expect(caretResult.found).toBe(false);
        if (!caretResult.found) {
            expect(caretResult.reason).toMatch(/type system/);
        }
    });
});

describe('the §14-style nested filter inside a loop', () => {
    // Mirrors the showcase's own §14 commentary: entering the loop pushes
    // `.` to mean the current customer, but `#Customers[...]`'s `[...]`
    // re-pushes `.` to mean each *candidate* row being filtered — so
    // reaching back to the loop's customer needs either the loop's own
    // alias (`customer`) or `^`; bare `.` there means the filtered row.
    const source = `
        loop customer in #Customers where .balance > 100 {
            UPDATE #Customers[. != ^ AND . != customer]
            SET { flagged: true };
        }
    `;

    test('bare `.` inside the UPDATE filter means the filtered candidate row, not the loop variable', async () => {
        const model = await parseModel(source);
        const bareDot = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && !n.field)!;
        const result = services.scopeResolver.resolveCurrentRecord(bareDot as never);
        expect(result.found).toBe(true);
        if (result.found) {
            expect(result.scope.tableName).toBe('Customers');
        }
    });

    test('`customer` (the loop alias) and `^` both reach the loop variable — the same frame, distinct from bare `.`', async () => {
        const model = await parseModel(source);

        const bareDot = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && !n.field)!;
        const bareCaret = AstUtils.streamAst(model).find(n => isParentRecord(n))!;
        const viaAlias = AstUtils.streamAst(model).find(n => isNameRef(n) && n.name === 'customer')!;

        const dotResult = services.scopeResolver.resolveCurrentRecord(bareDot as never);
        const caretResult = services.scopeResolver.resolveParentRecord(bareCaret as never);
        const aliasResult = services.scopeResolver.resolveNameRef(viaAlias as never);

        expect(dotResult.found).toBe(true);
        expect(caretResult.found).toBe(true);
        expect(aliasResult.found).toBe(true);

        if (dotResult.found && caretResult.found && aliasResult.found) {
            expect(caretResult.scope.tableName).toBe('Customers');
            expect(aliasResult.scope.tableName).toBe('Customers');
            // `^` and the loop's own alias land on the very same frame...
            expect(caretResult.scope.owner).toBe(aliasResult.scope.owner);
            // ...which is distinct from bare `.`'s (the filter's) frame.
            expect(dotResult.scope.owner).not.toBe(caretResult.scope.owner);
        }
    });

    test('the WHERE guard on `loop ... in #Customers where .balance > 100` sees the loop element as `.`', async () => {
        const model = await parseModel(source);
        const balance = AstUtils.streamAst(model).find(n => isCurrentRecord(n) && n.field === 'balance')!;
        const result = services.scopeResolver.resolveCurrentRecord(balance as never);
        expect(result.found).toBe(true);
    });
});

describe('KEY, valid only after GROUPBY', () => {
    test('resolves in SELECT after a GROUPBY clause', async () => {
        const model = await parseModel(`
            FROM Order
            GROUPBY .customer
            HAVING SUM(.total) > 1000
            SELECT KEY, SUM(.total) AS total_spent
        `);
        const key = AstUtils.streamAst(model).find(n => isGroupKeyRef(n))!;
        const result = services.scopeResolver.resolveGroupKeyRef(key as never);
        expect(result.found).toBe(true);
    });

    test('is unresolvable when there is no GROUPBY at all', async () => {
        const model = await parseModel(`
            FROM Order
            SELECT KEY
        `);
        const key = AstUtils.streamAst(model).find(n => isGroupKeyRef(n))!;
        const result = services.scopeResolver.resolveGroupKeyRef(key as never);
        expect(result.found).toBe(false);
        if (!result.found) {
            expect(result.reason).toMatch(/GROUPBY/);
        }
    });
});

describe('unresolved names come back as "not found," not a thrown error', () => {
    test('an unknown table opened inline via `#Name`', async () => {
        const model = await parseModel(`EXISTS(#TotallyUnknownTable[.x == 1])`);
        const namedScope = AstUtils.streamAst(model).find(n => isNamedScope(n) && n.name === 'TotallyUnknownTable')!;
        expect(() => services.scopeResolver.resolveNamedScope(namedScope as never)).not.toThrow();
        const result = services.scopeResolver.resolveNamedScope(namedScope as never);
        expect(result.found).toBe(false);
        if (!result.found) {
            expect(result.reason).toMatch(/unknown table or scope/);
        }
    });

    test('a known table opened via `#Name` still resolves', async () => {
        const model = await parseModel(`EXISTS(#Customer[.id == 1])`);
        const namedScope = AstUtils.streamAst(model).find(n => isNamedScope(n) && n.name === 'Customer')!;
        const result = services.scopeResolver.resolveNamedScope(namedScope as never);
        expect(result.found).toBe(true);
        if (result.found) {
            expect(result.scope.tableName).toBe('Customer');
        }
    });
});
