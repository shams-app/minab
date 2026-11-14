import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { DirectoryConfig } from '../src/host/config.js';
import { directoryHostFunctions } from '../src/host/directory-functions.js';
import { FixtureDirectory } from '../src/host/fixture-executor.js';
import type { SqlQuery } from '../src/language/minab-executor.js';
import { USER_TABLE } from '../src/language/minab-types.js';
import { scalarType } from '../src/language/schema.js';
import { createMinab, type DirectoryPort, type RunResult } from '../src/runtime/index.js';
import { openTestDatabase, type TestDatabase } from './support/database.js';

/**
 * MN.4 (security plan, P11): a `FROM` query may use users and groups that do not depend on the row. The set is listed
 * through the directory port before the query runs and bound as one array parameter; a user column is compared by id.
 * The interpreter reads the same record as a user, so a differential test runs each condition both ways.
 */

const user = (id: string, name: string, extra: Record<string, string | boolean | null> = {}) => ({ id, name, ...extra });

const CONFIG: DirectoryConfig = {
    users: [user('usr_sara', 'Sara'), user('usr_ali', 'Ali'), user('usr_neda', 'Neda'), user('usr_leyla', 'Leyla')],
    groups: [
        { name: 'Sales', members: ['usr_sara', 'usr_ali', 'usr_neda'], includes: [], tags: [] },
        { name: 'Support', members: ['usr_leyla'], includes: [], tags: [] },
        { name: 'TeamLeaders', members: ['usr_leyla'], includes: [], tags: [] },
        { name: 'Team Tabriz', members: ['usr_sara', 'usr_leyla'], includes: [], tags: ['team'] }
    ],
    routes: [
        { name: 'teamMates', returns: 'USERGROUP', body: "groupsOf(u)['team' IN .tags].members" },
        { name: 'teamLeader', returns: 'USERGROUP', body: 'teamMates(u) & @@TeamLeaders' }
    ],
    specialUsers: { currentUser: 'usr_sara', appUser: null }
};

interface TaskRow {
    id: string;
    status: string;
    owner: string | null;
    assignee: string | null;
    approvers: string[];
}

const ROWS: TaskRow[] = [
    { id: 't1', status: 'open', owner: 'usr_sara', assignee: 'usr_sara', approvers: ['usr_leyla'] },
    { id: 't2', status: 'open', owner: 'usr_ali', assignee: 'usr_leyla', approvers: ['usr_sara', 'usr_ali'] },
    { id: 't3', status: 'done', owner: 'usr_leyla', assignee: 'usr_sara', approvers: [] },
    { id: 't4', status: 'open', owner: null, assignee: null, approvers: ['usr_neda'] },
    { id: 't5', status: 'open', owner: 'usr_neda', assignee: 'usr_ali', approvers: ['usr_sara'] }
];

const text = (name: string, nullable = false) => ({ name, type: { kind: 'scalar' as const, type: scalarType('TEXT', { nullable }) } });

const TASK = {
    name: 'Task',
    primaryKey: 'id',
    columns: [
        text('id'),
        text('status'),
        { name: 'owner', type: { kind: 'ref' as const, table: USER_TABLE, nullable: true } },
        { name: 'assignee', type: { kind: 'ref' as const, table: USER_TABLE, nullable: true } },
        { name: 'approvers', type: { kind: 'collection' as const, table: USER_TABLE } }
    ]
};

let db: TestDatabase;
beforeAll(async () => {
    db = await openTestDatabase();
});
afterAll(async () => {
    await db.close();
});

const SETUP = `CREATE TABLE "Task" (id text PRIMARY KEY, status text, owner text, assignee text, approvers text[]);
INSERT INTO "Task" VALUES ${ROWS.map(r => `('${r.id}', '${r.status}', ${r.owner ? `'${r.owner}'` : 'NULL'}, ${r.assignee ? `'${r.assignee}'` : 'NULL'}, ARRAY[${r.approvers.map(a => `'${a}'`).join(', ')}]::text[])`).join(', ')};`;

interface Session {
    result: RunResult;
    statements: SqlQuery[];
}

/** Prepares `source` and runs it on the database, writing down each statement it sent. */
async function execute(
    source: string,
    options: { port?: DirectoryPort; record?: Record<string, unknown>; recordTable?: string; maxUsers?: number } = {}
): Promise<Session> {
    const fixture = new FixtureDirectory(CONFIG);
    const port = options.port ?? fixture;
    const functions = directoryHostFunctions(port, { routes: fixture.config.routes });
    const minab = createMinab({
        schema: { tables: [TASK], directory: fixture.schema() },
        functions: functions.declarations,
        ruleContext: { isFieldRule: false, recordTable: options.recordTable, specialUsers: fixture.specialUserDeclarations, groupNames: fixture.groupNames },
        limits: options.maxUsers === undefined ? undefined : { maxUsers: options.maxUsers }
    });
    const statements: SqlQuery[] = [];
    try {
        const program = await minab.prepare(source);
        expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
        const result = await db.isolated(SETUP, () =>
            program.run(
                { record: options.record, specialUsers: fixture.config.specialUsers },
                {
                    directory: port,
                    hostFunctions: functions.functions,
                    data: {
                        execute: query => {
                            statements.push(query);
                            return db.executor.execute(query);
                        }
                    }
                }
            )
        );
        return { result, statements };
    } finally {
        minab.dispose();
        fixture.close();
    }
}

const rowIds = (session: Session): string[] => {
    if (!session.result.ok) throw new Error(`${session.result.error.code}: ${session.result.error.message}`);
    return (session.result.value as { id: string }[]).map(r => r.id).sort();
};

describe('a person or a set that does not depend on the row (P11)', () => {
    test('one statement with one array parameter, and the same answer as the interpreter', async () => {
        const { result, statements } = await execute("COUNT(#Task[.assignee IN teamMates(@currentUser) AND .status != 'done'])");
        expect(result).toMatchObject({ ok: true, value: 2 });
        expect(statements).toHaveLength(1);
        expect(statements[0].text).toContain('ANY($1::text[])');
        expect(statements[0].params.map(p => (Array.isArray(p) ? [...p].sort() : p))).toContainEqual(['usr_leyla', 'usr_sara']);
        // A pipeline gives the same statement.
        const piped = await execute("FROM Task WHERE .assignee IN teamMates(@currentUser) AND .status != 'done' SELECT .id");
        expect(rowIds(piped)).toEqual(['t1', 't2']);
        expect(piped.statements).toHaveLength(1);
    });

    test('a user column compares ids with no directory read', async () => {
        const reads: string[] = [];
        const fixture = new FixtureDirectory(CONFIG);
        const watched = new Proxy(fixture as DirectoryPort, {
            get(target, property, receiver) {
                const member: unknown = Reflect.get(target, property, receiver);
                if (typeof member !== 'function') return member;
                return (...args: unknown[]) => {
                    reads.push(String(property));
                    return (member as (...a: unknown[]) => unknown).apply(target, args);
                };
            }
        });
        expect(rowIds(await execute('FROM Task WHERE .owner == @currentUser SELECT .id', { port: watched }))).toEqual(['t1']);
        expect(rowIds(await execute('FROM Task WHERE @currentUser IN .approvers SELECT .id', { port: watched }))).toEqual(['t2', 't5']);
        expect(reads).toEqual([]);
        fixture.close();
    });

    test('EXISTS over the overlap of a users column and a group, and COUNT of a column', async () => {
        expect(rowIds(await execute('FROM Task WHERE EXISTS(.approvers & @@Support) SELECT .id'))).toEqual(['t1']);
        expect(rowIds(await execute('FROM Task WHERE COUNT(.approvers) > 1 SELECT .id'))).toEqual(['t2']);
        expect(rowIds(await execute('FROM Task WHERE .owner IN @@Sales AND .assignee != @currentUser SELECT .id'))).toEqual(['t2', 't5']);
    });

    test('findUser, a filter and a variable give the same ids', async () => {
        expect(rowIds(await execute("FROM Task WHERE .owner == findUser('usr_ali') SELECT .id"))).toEqual(['t2']);
        expect(rowIds(await execute("FROM Task WHERE .owner IN @@Sales[.name == 'Neda'] SELECT .id"))).toEqual(['t5']);
        expect(rowIds(await execute('let boss: USER = single(@@TeamLeaders);\nFROM Task WHERE .assignee == boss SELECT .id'))).toEqual(['t2']);
    });

    test('a part that depends on each row stays compile.directoryInSql, with the part named', async () => {
        const named = await execute('FROM Task WHERE @currentUser IN teamLeader(.owner) SELECT .id');
        expect(named.result).toMatchObject({ ok: false, error: { code: 'compile.directoryInSql' } });
        if (!named.result.ok) expect(named.result.error.message).toContain('teamLeader(.owner)');
        expect(named.statements).toEqual([]);
        const column = await execute('FROM Task WHERE .owner.name == "Sara" SELECT .id');
        expect(column.result).toMatchObject({ ok: false, error: { code: 'compile.directoryInSql' } });
        if (!column.result.ok) expect(column.result.error.message).toContain('.owner');
    });

    test('a set of 10,001 people is eval.tooManyUsers, before any statement', async () => {
        const all = Array.from({ length: 10_001 }, (_, i) => `usr_${i}`);
        const port: DirectoryPort = {
            resolveUsers: async asked => asked.map(id => ({ id, name: id })),
            findUser: async () => null,
            findGroup: async name => ({ id: `grp_${name}`, name, tags: [] }),
            members: async (_group, cursor) => {
                const start = cursor === undefined ? 0 : Number(cursor);
                return { ids: all.slice(start, start + 5000), ...(start + 5000 < all.length ? { next: String(start + 5000) } : {}) };
            },
            isMember: async () => true,
            groupsOf: async () => [],
            callRoute: async () => [],
            schema: () => ({})
        };
        const session = await execute('FROM Task WHERE .assignee IN @@Sales SELECT .id', { port });
        expect(session.result).toMatchObject({ ok: false, error: { code: 'eval.tooManyUsers' } });
        expect(session.statements).toEqual([]);
    });

    test('compile() shows the SQL with each listed part as one parameter', async () => {
        const fixture = new FixtureDirectory(CONFIG);
        const minab = createMinab({
            schema: { tables: [TASK], directory: fixture.schema() },
            ruleContext: { isFieldRule: false, specialUsers: fixture.specialUserDeclarations, groupNames: fixture.groupNames }
        });
        try {
            const compiled = (await minab.prepare('FROM Task WHERE .assignee IN @@Sales AND .owner == @currentUser SELECT .id')).compile();
            expect(compiled.ok).toBe(true);
            if (compiled.ok) expect(compiled.sql.text).toMatch(/ANY\(\$1::text\[\]\)/);
        } finally {
            minab.dispose();
            fixture.close();
        }
    });
});

describe('differential: the interpreter and the SQL give the same answer for each row', () => {
    const CONDITIONS = [
        '.owner == @currentUser',
        '.owner != @currentUser',
        '.owner == .assignee',
        '.owner IN @@Sales',
        '.assignee IN @@Sales - @@Support',
        '.assignee IN teamMates(@currentUser)',
        '@currentUser IN .approvers',
        '@currentUser IN @@Sales',
        '.owner IN @@Support | @@Sales',
        "'usr_x' == 'usr_x' AND .owner IN @@Sales & @@Sales[.name != 'Ali']",
        'EXISTS(.approvers & @@Support)',
        'EXISTS(.approvers & @@Sales)',
        'EXISTS(.approvers)',
        'COUNT(.approvers) == 2',
        '.owner == findUser("usr_ali") OR @currentUser IN .approvers'
    ];

    for (const condition of CONDITIONS) {
        test(condition, async () => {
            const inSql = rowIds(await execute(`FROM Task WHERE ${condition} SELECT .id`));
            const inMemory: string[] = [];
            for (const row of ROWS) {
                const answer = await execute(condition, { record: { ...row }, recordTable: 'Task' });
                if (!answer.result.ok) throw new Error(`${answer.result.error.code}: ${answer.result.error.message}`);
                if (answer.result.value === true) inMemory.push(row.id);
            }
            expect(inSql).toEqual(inMemory.sort());
        });
    }
});
