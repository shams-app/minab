import { describe, expect, test } from 'vitest';
import type { DirectoryConfig } from '../src/host/config.js';
import { directoryHostFunctions } from '../src/host/directory-functions.js';
import { FixtureDirectory } from '../src/host/fixture-executor.js';
import { createMinab, type DirectoryPort, type Limits, type RunResult } from '../src/runtime/index.js';
import { USER_TABLE } from '../src/language/minab-types.js';
import { scalarType } from '../src/language/schema.js';

/**
 * MN.2 (security plan): programs with users and groups run. Every example of the proposal (P3–P11) is evaluated against a
 * fixture directory, and a spy shows what the port was asked: membership never lists a group (P11).
 */

const user = (id: string, name: string, extra: Record<string, string | boolean | null> = {}) => ({ id, name, ...extra });

const CONFIG: DirectoryConfig = {
    users: [
        user('usr_sara', 'Sara', { email: 'sara@example.com', phone: '+989121112233', city: 'Tabriz', role: 'member' }),
        user('usr_ali', 'Ali', { email: 'ali@gmail.com', city: 'Marand', role: 'member' }),
        user('usr_neda', 'Neda', { email: 'neda@gmail.com', city: 'Tabriz', role: 'viewer' }),
        user('usr_leyla', 'Leyla', { email: 'leyla@example.com', city: 'Tabriz', role: 'admin' }),
        user('usr_omid', 'Omid', { email: 'omid@example.com', city: 'Urmia', left: true })
    ],
    groups: [
        { name: 'Sales', members: ['usr_sara', 'usr_ali', 'usr_neda'], includes: [], tags: [] },
        { name: 'Support', members: ['usr_leyla'], includes: [], tags: [] },
        { name: 'Interns', members: ['usr_ali'], includes: [], tags: [] },
        { name: 'Managers', members: ['usr_leyla'], includes: [], tags: [] },
        { name: 'TeamLeaders', members: ['usr_leyla'], includes: [], tags: [] },
        { name: 'ActiveUsers', members: ['usr_sara', 'usr_ali', 'usr_neda', 'usr_leyla'], includes: [], tags: [] },
        { name: 'LazyUsers', members: ['usr_ali', 'usr_neda'], includes: [], tags: [] },
        { name: 'Contractors', members: ['usr_neda'], includes: [], tags: [] },
        { name: 'Team Tabriz', members: ['usr_sara', 'usr_leyla'], includes: [], tags: ['team'] },
        { name: 'Everyone in Sales or Support', members: [], includes: ['Sales', 'Support'], tags: [] }
    ],
    routes: [
        { name: 'teamMates', returns: 'USERGROUP', body: "groupsOf(u)['team' IN .tags].members" },
        { name: 'teamLeader', returns: 'USERGROUP', body: 'teamMates(u) & @@TeamLeaders' },
        { name: 'manager', returns: 'USER?', body: 'singleOrNull(teamLeader(u))' }
    ],
    specialUsers: { currentUser: 'usr_sara', appUser: null }
};

/** The calls a port got, by method name. */
function spy(port: DirectoryPort): { port: DirectoryPort; calls: string[] } {
    const calls: string[] = [];
    const wrapped = new Proxy(port, {
        get(target, property, receiver) {
            const member: unknown = Reflect.get(target, property, receiver);
            if (typeof member !== 'function') return member;
            return (...args: unknown[]) => {
                calls.push(String(property));
                return (member as (...a: unknown[]) => unknown).apply(target, args);
            };
        }
    });
    return { port: wrapped, calls };
}

const text = (name: string) => ({ name, type: { kind: 'scalar' as const, type: scalarType('TEXT', { nullable: true }) } });

interface Setup {
    config?: DirectoryConfig;
    port?: DirectoryPort;
    specialUsers?: Record<string, string | null>;
    record?: Record<string, unknown>;
    limits?: Partial<Limits>;
    localDirectory?: boolean;
    /** `true`: the checker is not given the group names, so an unknown `@@name` is found when the program runs. */
    unchecked?: boolean;
}

/** Prepares and runs `source` against the fixture directory (or `port`). */
async function evaluate(source: string, setup: Setup = {}): Promise<RunResult> {
    const fixture = new FixtureDirectory(setup.config ?? CONFIG);
    const port = setup.port ?? fixture;
    const functions = directoryHostFunctions(port, { routes: fixture.config.routes });
    const minab = createMinab({
        schema: {
            tables: [
                {
                    name: 'Task',
                    columns: [
                        text('id'),
                        { name: 'owner', type: { kind: 'ref', table: USER_TABLE, nullable: true } },
                        { name: 'assignees', type: { kind: 'collection', table: USER_TABLE } },
                        { name: 'approvers', type: { kind: 'collection', table: USER_TABLE } }
                    ]
                }
            ],
            directory: fixture.schema()
        },
        functions: functions.declarations,
        ruleContext: {
            isFieldRule: false,
            recordTable: 'Task',
            specialUsers: fixture.specialUserDeclarations,
            groupNames: setup.unchecked ? undefined : fixture.groupNames
        },
        limits: setup.limits,
        localDirectory: setup.localDirectory
    });
    try {
        const program = await minab.prepare(source);
        expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
        return await program.run(
            { record: setup.record, specialUsers: setup.specialUsers ?? fixture.config.specialUsers },
            { directory: port, hostFunctions: functions.functions }
        );
    } finally {
        minab.dispose();
        fixture.close();
    }
}

const value = async (source: string, setup?: Setup): Promise<unknown> => {
    const result = await evaluate(source, setup);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const failure = async (source: string, setup?: Setup): Promise<string> => {
    const result = await evaluate(source, setup);
    return result.ok ? 'ok' : result.error.code;
};
const ids = (rows: unknown): string[] => (rows as { id: string }[]).map(row => row.id).sort();

describe('membership is asked, never listed (P11)', () => {
    test('u IN A - B asks isMember twice and never members', async () => {
        const watched = spy(new FixtureDirectory(CONFIG));
        expect(await value('@currentUser IN @@Sales - @@Interns', { port: watched.port })).toBe(true);
        expect(watched.calls.filter(call => call === 'isMember')).toHaveLength(2);
        expect(watched.calls).not.toContain('members');
    });

    test('the set operators and the complement, on one user', async () => {
        const check = (source: string, expected: boolean) => async () => expect(await value(source)).toBe(expected);
        await check('@currentUser IN @@Sales + @@Support - @@Interns', true)();
        await check('@currentUser IN @@Sales & @@Interns', false)();
        await check('@currentUser IN @@Sales | @@ActiveUsers', false)();
        await check('@currentUser IN @@Interns | @@ActiveUsers', true)();
        await check('@currentUser IN !@@Contractors', true)();
        await check('findUser("neda@gmail.com") IN !@@Contractors', false)();
        await check('@currentUser IN !@@everyone', false)();
    });

    test('A + B & C reads as A + (B & C), and !A & B is B without A', async () => {
        expect(await value('findUser("ali@gmail.com") IN @@Support + @@Sales & @@Interns')).toBe(true);
        expect(await value('findUser("sara@example.com") IN !@@Interns & @@Sales')).toBe(true);
        expect(await value('findUser("ali@gmail.com") IN !@@Interns & @@Sales')).toBe(false);
    });

    test('a filter runs on the one user it is asked about', async () => {
        const watched = spy(new FixtureDirectory(CONFIG));
        expect(await value("@currentUser IN @@Sales[.city == 'Tabriz']", { port: watched.port })).toBe(true);
        expect(watched.calls).not.toContain('members');
        expect(watched.calls.filter(call => call === 'resolveUsers')).toHaveLength(1);
    });

    test('a user or a nobody on the right of IN is a set of one or none (P9)', async () => {
        expect(await value('@currentUser IN @currentUser')).toBe(true);
        expect(await value('@currentUser IN manager(@currentUser)')).toBe(false);
        expect(await value('findUser("leyla@example.com") IN manager(@currentUser)')).toBe(true);
        expect(await value('@currentUser IN @appUser')).toBe(false);
    });
});

describe('listing (COUNT, a loop, a result, single)', () => {
    test('COUNT(G[filter]) lists the group once and filters', async () => {
        const watched = spy(new FixtureDirectory(CONFIG));
        expect(await value("COUNT(@@Sales[.city == 'Tabriz'])", { port: watched.port })).toBe(2);
        expect(watched.calls.filter(call => call === 'members')).toHaveLength(1);
        expect(watched.calls).not.toContain('isMember');
    });

    test('COUNT and EXISTS read no user record', async () => {
        const watched = spy(new FixtureDirectory(CONFIG));
        expect(await value('COUNT(@@Sales + @@Support)', { port: watched.port })).toBe(4);
        expect(await value('EXISTS(@@Interns)', { port: watched.port })).toBe(true);
        expect(watched.calls).not.toContain('resolveUsers');
    });

    test('single and singleOrNull', async () => {
        expect(await value("single(@@Sales[.city == 'Marand'])")).toMatchObject({ id: 'usr_ali', name: 'Ali', city: 'Marand' });
        expect(await failure("single(@@Sales[.city == 'Tabriz'])")).toBe('eval.notExactlyOne');
        expect(await failure("single(@@Sales[.city == 'Nowhere'])")).toBe('eval.notExactlyOne');
        expect(await value("singleOrNull(@@Sales[.city == 'Nowhere'])")).toBeNull();
        expect(await failure("singleOrNull(@@Sales[.city == 'Tabriz'])")).toBe('eval.notExactlyOne');
    });

    test('a loop goes through the users of a set, with `.` as each user', async () => {
        expect(await value("let names: TEXT = ''; loop u in @@Sales[.city == 'Tabriz'] { names += u.name + ','; } names")).toMatch(
            /^(Sara|Neda),(Sara|Neda),$/
        );
        // `.` is the user inside the loop too.
        expect(await value("let n: INTEGER = 0; loop u in @@Sales { if! .city == 'Tabriz' { n += 1; } } n")).toBe(2);
    });

    test('a result is a list of records; a set expression has no order', async () => {
        expect(ids(await value('@@Sales - @@Interns'))).toEqual(['usr_neda', 'usr_sara']);
        expect(ids(await value('@@Sales + @@Support'))).toEqual(['usr_ali', 'usr_leyla', 'usr_neda', 'usr_sara']);
        expect(ids(await value('@@Sales & @@ActiveUsers & !@@Interns'))).toEqual(['usr_neda', 'usr_sara']);
        expect(ids(await value('@@Sales | @@Interns'))).toEqual(['usr_neda', 'usr_sara']);
        expect(await value('@currentUser')).toMatchObject({ id: 'usr_sara', email: 'sara@example.com' });
        expect(await value('@appUser')).toBeNull();
    });

    test('! lists everyone except the set, and never an application account', async () => {
        expect(ids(await value('!@@Sales'))).toEqual(['usr_leyla']);
        expect(await value('!@@everyone')).toEqual([]);
    });

    test('nested groups are flattened', async () => {
        expect(await value('COUNT(@@`Everyone in Sales or Support`)')).toBe(4);
    });
});

describe('the proposal examples (P1–P11)', () => {
    test('P1 and P9: types, COUNT, EXISTS', async () => {
        expect(await value('let sales: USERGROUP = @@Sales; let me: USER = @currentUser; COUNT(sales)')).toBe(3);
        expect(await value("EXISTS(@@Sales[.city == 'Tabriz'])")).toBe(true);
        expect(await value("EXISTS(@@Sales[.city == 'Nowhere'])")).toBe(false);
    });

    test('P2: system groups, backtick names, findGroup', async () => {
        expect(await value('COUNT(@@everyone)')).toBe(4);
        expect(await value('COUNT(@@admins)')).toBe(1);
        expect(await value('COUNT(@@`Team Tabriz`)')).toBe(2);
        expect(await value("let groupName: TEXT = 'Sales'; COUNT(findGroup(groupName))")).toBe(3);
        expect(await failure("findGroup('Nope')")).toBe('eval.groupNotFound');
    });

    test('P4: findUser by id, e-mail and phone (Persian digits too), never a left member', async () => {
        expect(await value("findUser('sara@example.com').name")).toBe('Sara');
        expect(await value("findUser('SARA@example.com').id")).toBe('usr_sara');
        expect(await value("findUser('usr_ali').city")).toBe('Marand');
        expect(await value("findUser('09121112233').id")).toBe('usr_sara');
        expect(await value("findUser('۰۹۱۲۱۱۱۲۲۳۳').id")).toBe('usr_sara');
        expect(await failure("findUser('omid@example.com')")).toBe('eval.userNotFound');
        expect(await failure("findUser('nobody')")).toBe('eval.userNotFound');
    });

    test('P6: filters with scoped and workspace attributes and the parent record', async () => {
        const config: DirectoryConfig = {
            ...CONFIG,
            users: CONFIG.users.map(u => (u.id === 'usr_sara' ? { ...u, department: 'IT', 'person:city': 'Marand' } : u))
        };
        expect(ids(await value("@@everyone[.department == 'IT' AND .`person:city` == 'Marand']", { config }))).toEqual(['usr_sara']);
        expect(ids(await value("@@everyone[.city == 'Marand' AND .role != 'viewer']"))).toEqual(['usr_ali']);
        expect(ids(await value('@@Sales[.id != ^.owner.id]', { record: { owner: 'usr_ali' } }))).toEqual(['usr_neda', 'usr_sara']);
    });

    test('P7: routes, groupsOf and group tags', async () => {
        expect(ids(await value('teamMates(@currentUser)'))).toEqual(['usr_leyla', 'usr_sara']);
        expect(ids(await value("teamLeader(findUser('sara@example.com'))"))).toEqual(['usr_leyla']);
        expect(await value("findUser('leyla@example.com') IN teamMates(@currentUser) & @@TeamLeaders")).toBe(true);
        // groupsOf lists every group the user is in, the system groups too.
        expect(await value('COUNT(groupsOf(@currentUser))')).toBe(6);
        expect(await value("groupsOf(@currentUser)['team' IN .tags].name")).toEqual(['Team Tabriz']);
    });

    test('P8: special users, specialUser(text), a missing one', async () => {
        expect(await value("specialUser('currentUser').id")).toBe('usr_sara');
        expect(await value("specialUser('appUser')")).toBeNull();
        expect(await failure("specialUser('flowStarter')")).toBe('eval.userNotFound');
        expect(await failure('@currentUser', { specialUsers: {} })).toBe('eval.missingInput');
    });

    test('P10: user columns of a record', async () => {
        const record = { owner: 'usr_sara', assignees: ['usr_ali', 'usr_neda'], approvers: ['usr_sara'] };
        expect(await value('.owner == @currentUser', { record })).toBe(true);
        expect(await value('.owner != @currentUser', { record })).toBe(false);
        expect(await value('.owner.name', { record })).toBe('Sara');
        expect(await value('.owner.id == "usr_sara"', { record })).toBe(true);
        expect(await value('@currentUser IN .approvers', { record })).toBe(true);
        expect(await value('COUNT(.assignees)', { record })).toBe(2);
        expect(ids(await value(".assignees[.city == 'Marand']", { record }))).toEqual(['usr_ali']);
        expect(await value('.owner == findUser("usr_sara")', { record })).toBe(true);
    });

    test('P10: someone who left reads as that person, not as empty', async () => {
        const record = { owner: 'usr_omid', approvers: ['usr_omid'] };
        expect(await value('.owner.name', { record })).toBe('Omid');
        expect(await value('.owner.email', { record })).toBeNull();
        expect(await value('.owner is null', { record })).toBe(false);
        expect(await value('.owner IN @@everyone', { record })).toBe(false);
        expect(await value('.owner IN @@Sales', { record })).toBe(false);
        expect(await value('COUNT(.approvers)', { record })).toBe(1);
        expect(await value('.owner IN @@everyone', { record: { owner: null } })).toBe(false);
    });

    test('the brainstorm block, in the approved syntax', async () => {
        const program = `
            let lazyUsers: USERGROUP = @@LazyUsers;
            let activeName: TEXT = 'ActiveUsers';
            let intersection: USERGROUP = lazyUsers & findGroup(activeName);
            let union: USERGROUP = lazyUsers + @@Sales;
            let partial: USERGROUP = lazyUsers - @@Sales;
            let exclusive: USERGROUP = lazyUsers | @@Sales;
            let others: USERGROUP = !intersection;
            let subgroup: USERGROUP = intersection[.email LIKE '%@gmail.com'];
            let theCurrent: USER = @currentUser;
            let userName: TEXT = 'currentUser';
            let sameUser: USER? = specialUser(userName);
            let aGroup: USERGROUP = @currentUser + findUser('ali@gmail.com');
            let fromGroup: USER = single(aGroup[.id == 'usr_ali']);
            let fromBoth: USER = single((aGroup + @@Support)[.email LIKE '%@gmail.com']);
            let a3sTeamLeaders: USERGROUP = teamMates(theCurrent) & @@TeamLeaders;
            {
                intersection: COUNT(intersection), union: COUNT(union), partial: COUNT(partial), exclusive: COUNT(exclusive),
                others: COUNT(others), subgroup: COUNT(subgroup), leaders: COUNT(a3sTeamLeaders),
                fromGroup: fromGroup.id, fromBoth: fromBoth.id, sameUser: sameUser.id
            }
        `;
        expect(await value(program)).toEqual({
            intersection: 2,
            union: 3,
            partial: 0,
            exclusive: 1,
            others: 2,
            subgroup: 2,
            leaders: 1,
            fromGroup: 'usr_ali',
            fromBoth: 'usr_ali',
            sameUser: 'usr_sara'
        });
    });
});

describe('limits and errors', () => {
    /** A directory with one group of `size` users, that answers pages of 5,000 ids. */
    function bigDirectory(size: number): DirectoryPort {
        const all = Array.from({ length: size }, (_, i) => `usr_${i}`);
        return {
            resolveUsers: async asked => asked.map(id => ({ id, name: id })),
            findUser: async () => null,
            findGroup: async name => ({ id: `grp_${name}`, name, tags: [] }),
            members: async (_group, cursor) => {
                const start = cursor === undefined ? 0 : Number(cursor);
                return { ids: all.slice(start, start + 5000), ...(start + 5000 < size ? { next: String(start + 5000) } : {}) };
            },
            isMember: async () => true,
            groupsOf: async () => [],
            callRoute: async () => [],
            schema: () => ({})
        };
    }

    test('a list of 10,000 users is fine and one of 10,001 is eval.tooManyUsers', async () => {
        expect(
            await value('COUNT(@@Big)', {
                port: bigDirectory(10_000),
                config: { ...CONFIG, groups: [...CONFIG.groups, { name: 'Big', members: [], includes: [], tags: [] }] }
            })
        ).toBe(10_000);
        expect(
            await failure('COUNT(@@Big)', {
                port: bigDirectory(10_001),
                config: { ...CONFIG, groups: [...CONFIG.groups, { name: 'Big', members: [], includes: [], tags: [] }] }
            })
        ).toBe('eval.tooManyUsers');
    });

    test('the limit maxUsers can be set by the host, and membership has none', async () => {
        expect(await failure('COUNT(@@Sales)', { limits: { maxUsers: 2 } })).toBe('eval.tooManyUsers');
        expect(await value('COUNT(@@Sales)', { limits: { maxUsers: 3 } })).toBe(3);
        // Membership is a question about one user: no limit applies to it.
        expect(await value('@currentUser IN @@Sales', { limits: { maxUsers: 1 } })).toBe(true);
    });

    test('a group or a user that is not there', async () => {
        expect(await failure('COUNT(@@Nope)', { unchecked: true })).toBe('eval.groupNotFound');
        expect(await failure("findUser('x@y.z')")).toBe('eval.userNotFound');
    });

    test('a run with no directory port fails with a clear error', async () => {
        const minab = createMinab({
            schema: { tables: [] },
            ruleContext: { isFieldRule: false, specialUsers: [{ name: 'currentUser', type: 'USER' }] }
        });
        const program = await minab.prepare('@currentUser IN @@Sales');
        const result = await program.run({ specialUsers: { currentUser: 'usr_sara' } });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
        minab.dispose();
    });

    test('a port that throws gives only a code, never its text', async () => {
        const port: DirectoryPort = { ...bigDirectory(1), isMember: async () => Promise.reject(new Error('secret: sara@example.com')) };
        const result = await evaluate('@currentUser IN @@Sales', { port });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    test('the wall time and the abort signal stop a slow port', async () => {
        const port: DirectoryPort = { ...bigDirectory(1), isMember: () => new Promise(() => {}) };
        expect(await failure('@currentUser IN @@Sales', { port, limits: { wallTimeMs: 50 } })).toBe('limit.timeout');
    });

    test('two sets are not compared with ==, and CAST needs users', async () => {
        expect(await failure('@@Sales == @@Sales')).toBe('eval.failed');
        expect(await failure('CAST(5 AS USERGROUP)')).toBe('eval.castFailed');
        expect(await value('COUNT(CAST(@currentUser AS USERGROUP))')).toBe(1);
    });
});

describe('a port that answers a filter over everyone (findUsers)', () => {
    test('findUsers answers it, and null falls back to listing everyone', async () => {
        const fixture = new FixtureDirectory(CONFIG);
        const filters: string[] = [];
        const fast: DirectoryPort = {
            resolveUsers: ids => fixture.resolveUsers(ids),
            findUser: key => fixture.findUser(key),
            findGroup: name => fixture.findGroup(name),
            members: (group, cursor) => fixture.members(group, cursor),
            isMember: (id, group) => fixture.isMember(id, group),
            groupsOf: id => fixture.groupsOf(id),
            callRoute: () => Promise.resolve([]),
            schema: () => fixture.schema(),
            findUsers: async filter => {
                filters.push(filter.source);
                return filter.source.includes('Marand') ? [{ id: 'usr_ali', name: 'Ali' }] : null;
            }
        };
        const watched = spy(fast);
        expect(await value("COUNT(@@everyone[.city == 'Marand'])", { port: watched.port })).toBe(1);
        expect(watched.calls).not.toContain('members');
        expect(filters).toEqual([".city == 'Marand'"]);
        expect(await value("COUNT(@@everyone[.city == 'Tabriz'])", { port: watched.port })).toBe(3);
        expect(watched.calls).toContain('members');
    });
});

describe('analysis and SQL', () => {
    async function prepare(source: string, options: { localDirectory?: boolean } = {}) {
        const fixture = new FixtureDirectory(CONFIG);
        const minab = createMinab({
            schema: {
                tables: [{ name: 'Task', columns: [text('id'), { name: 'owner', type: { kind: 'ref', table: USER_TABLE, nullable: true } }] }],
                directory: fixture.schema()
            },
            functions: fixture.functions().declarations,
            ruleContext: { isFieldRule: false, recordTable: 'Task', specialUsers: fixture.specialUserDeclarations, groupNames: fixture.groupNames },
            localDirectory: options.localDirectory
        });
        const program = await minab.prepare(source);
        fixture.close();
        minab.dispose();
        return program;
    }

    test('usesDirectory, and tier data unless the port is local', async () => {
        for (const source of ['@currentUser IN @@Sales', '.owner == @currentUser', "findUser('usr_ali').name"]) {
            const program = await prepare(source);
            expect(program.analysis).toMatchObject({ usesDirectory: true, tier: 'data' });
        }
        expect((await prepare('@currentUser IN @@Sales', { localDirectory: true })).analysis).toMatchObject({ usesDirectory: true, tier: 'local' });
        expect((await prepare('1 + 1')).analysis).toMatchObject({ usesDirectory: false, tier: 'local' });
    });

    test('a query cannot read users yet: compile.directoryInSql, with the part named', async () => {
        for (const [source, part] of [
            ['FROM Task WHERE @currentUser IN @@Sales SELECT .id', '@currentUser IN @@Sales'],
            ['FROM Task WHERE .owner.name == "Sara" SELECT .id', '.owner'],
            ['FROM Task WHERE @currentUser IN teamLeader(.owner) SELECT .id', '@currentUser']
        ] as const) {
            const program = await prepare(source);
            const compiled = program.compile();
            expect(compiled).toMatchObject({ ok: false, error: { code: 'compile.directoryInSql' } });
            if (!compiled.ok) expect(compiled.error.message).toContain(part);
        }
    });

    test('running such a query is the same error', async () => {
        expect(await failure('FROM Task WHERE @currentUser IN @@Sales SELECT .id')).toBe('compile.directoryInSql');
    });
});
