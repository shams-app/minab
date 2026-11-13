import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT_OK, EXIT_PROGRAM_ERROR, runCli, type CliIo } from '../src/cli/main.js';
import { ConfigError, parseConfig, parseDirectory, type DirectoryConfig } from '../src/host/config.js';
import { directoryHostFunctions, hostFunctionsOf, MAX_ROUTE_DEPTH, routeHostFunction } from '../src/host/directory-functions.js';
import { FixtureDirectory } from '../src/host/fixture-executor.js';
import { createMinab, type DirectoryPort, type HostFunctions, type RunResult } from '../src/runtime/index.js';

/**
 * MN.2 (security plan): the ready-made directory host functions, the routes (at most 3 nested calls), the fixture
 * directory and its `directory` config section.
 */

const CONFIG: DirectoryConfig = {
    users: [
        { id: 'usr_sara', name: 'Sara', email: 'sara@example.com', city: 'Tabriz' },
        { id: 'usr_ali', name: 'Ali', email: 'ali@example.com', city: 'Marand' }
    ],
    groups: [
        { name: 'Sales', members: ['usr_sara', 'usr_ali'], includes: [], tags: ['team'] },
        { name: 'TeamLeaders', members: ['usr_ali'], includes: [], tags: [] }
    ],
    routes: [
        // The card's example (P7).
        { name: 'teamMates', returns: 'USERGROUP', body: "groupsOf(u)['team' IN .tags].members" },
        { name: 'teamLeader', returns: 'USERGROUP', body: 'teamMates(u) & @@TeamLeaders' },
        // Three routes deep is the most: a1 -> a2 -> a3 answers, b1 -> b2 -> b3 -> b4 does not.
        { name: 'a1', returns: 'USERGROUP', body: 'a2(u)' },
        { name: 'a2', returns: 'USERGROUP', body: 'a3(u)' },
        { name: 'a3', returns: 'USERGROUP', body: '@@Sales' },
        { name: 'b1', returns: 'USERGROUP', body: 'b2(u)' },
        { name: 'b2', returns: 'USERGROUP', body: 'b3(u)' },
        { name: 'b3', returns: 'USERGROUP', body: 'b4(u)' },
        { name: 'b4', returns: 'USERGROUP', body: '@@Sales' },
        { name: 'again', returns: 'USERGROUP', body: 'again(u)' },
        { name: 'boss', returns: 'USER?', body: 'singleOrNull(@@TeamLeaders)' },
        { name: 'broken', returns: 'USER?', body: 'COUNT(' }
    ],
    specialUsers: { currentUser: 'usr_sara' }
};

async function run(
    source: string,
    config: DirectoryConfig = CONFIG,
    hostFunctions?: (port: DirectoryPort) => {
        declarations: never[] | { name: string; params: { name: string; type: string }[]; returns: string }[];
        functions: HostFunctions;
    }
): Promise<RunResult> {
    const fixture = new FixtureDirectory(config);
    const own = directoryHostFunctions(fixture, { routes: config.routes });
    const extra = hostFunctions?.(fixture);
    const minab = createMinab({
        schema: { tables: [], directory: fixture.schema() },
        functions: [...own.declarations, ...(extra?.declarations ?? [])],
        ruleContext: { isFieldRule: false, specialUsers: fixture.specialUserDeclarations, groupNames: fixture.groupNames }
    });
    try {
        const program = await minab.prepare(source);
        expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
        const functions: HostFunctions = {
            call: (name, args, context) => (extra && extra.declarations.some(d => d.name === name) ? extra.functions : own.functions).call(name, args, context)
        };
        return await program.run({ specialUsers: config.specialUsers }, { directory: fixture, hostFunctions: functions });
    } finally {
        minab.dispose();
        fixture.close();
    }
}

const code = async (source: string, config?: DirectoryConfig): Promise<string> => {
    const result = await run(source, config);
    return result.ok ? 'ok' : result.error.code;
};

describe('the declarations', () => {
    test('six functions, each with the types of P4, P5, P7 and P8', () => {
        const { declarations } = directoryHostFunctions(new FixtureDirectory(CONFIG));
        expect(declarations.map(d => [d.name, d.params.map(p => p.type), d.returns])).toEqual([
            ['findUser', ['TEXT'], 'USER'],
            ['findGroup', ['TEXT'], 'USERGROUP'],
            ['single', ['USERGROUP'], 'USER'],
            ['singleOrNull', ['USERGROUP'], 'USER?'],
            ['specialUser', ['TEXT'], 'USER?'],
            ['groupsOf', ['USER'], 'GROUP[]']
        ]);
    });

    test('a local port makes every function local, and a route is declared like them', () => {
        const port = new FixtureDirectory(CONFIG);
        expect(directoryHostFunctions(port, { local: true }).declarations.every(d => d.local === true)).toBe(true);
        expect(routeHostFunction(port, 'manager', 'USER?').declaration).toEqual({ name: 'manager', params: [{ name: 'u', type: 'USER' }], returns: 'USER?' });
    });

    test('a name nobody implements is a host function failure', () => {
        expect(() => hostFunctionsOf([]).call('nothing', [], { signal: new AbortController().signal })).toThrow(/no implementation/);
    });
});

describe('routes (P7)', () => {
    test('the example: the team leader of the team of a user', async () => {
        const result = await run("teamLeader(findUser('sara@example.com'))");
        expect(result).toMatchObject({ ok: true, value: [{ id: 'usr_ali' }] });
    });

    test('three routes deep is allowed, a fourth nested one is eval.routeCycle', async () => {
        expect(MAX_ROUTE_DEPTH).toBe(3);
        expect(await code('COUNT(a1(@currentUser))')).toBe('ok');
        expect(await code('COUNT(b1(@currentUser))')).toBe('eval.routeCycle');
    });

    test('a route that calls itself is eval.routeCycle', async () => {
        expect(await code('COUNT(again(@currentUser))')).toBe('eval.routeCycle');
    });

    test('a route that answers one user or nobody', async () => {
        expect(await run('boss(@currentUser).name')).toMatchObject({ ok: true, value: 'Ali' });
        expect(await run('boss(@currentUser) IN @@Sales')).toMatchObject({ ok: true, value: true });
    });

    test('a route with an error in its body is eval.failed, and says which route', async () => {
        const result = await run('boss2(@currentUser)', { ...CONFIG, routes: [{ name: 'boss2', returns: 'USER?', body: 'COUNT(' }] });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
        if (!result.ok) expect(result.error.message).toContain('boss2');
    });

    test('the port is asked with the depth of the call: 0 for a call from the program', async () => {
        const depths: number[] = [];
        const port = new FixtureDirectory(CONFIG);
        const spied: DirectoryPort = Object.assign(Object.create(port) as DirectoryPort, {
            callRoute: (name: string, id: string, context: { signal: AbortSignal; depth: number }) => {
                depths.push(context.depth);
                return port.callRoute(name, id, context);
            }
        });
        const functions = directoryHostFunctions(spied, { routes: CONFIG.routes });
        const minab = createMinab({
            schema: { tables: [], directory: port.schema() },
            functions: functions.declarations,
            ruleContext: { isFieldRule: false, specialUsers: port.specialUserDeclarations, groupNames: port.groupNames }
        });
        const program = await minab.prepare('COUNT(a1(@currentUser))');
        expect(await program.run({ specialUsers: { currentUser: 'usr_sara' } }, { directory: port, hostFunctions: functions.functions })).toMatchObject({
            ok: true,
            value: 2
        });
        // One call came from the program. The routes inside the body run through the fixture, one level deeper each.
        expect(depths).toEqual([0]);
        minab.dispose();
        port.close();
    });

    test('a USER? route whose body answers two users is eval.notExactlyOne', async () => {
        expect(await code('manyBoss(@currentUser)', { ...CONFIG, routes: [{ name: 'manyBoss', returns: 'USER?', body: 'single(@@Sales)' }] })).toBe(
            'eval.notExactlyOne'
        );
        expect(await code('manyBoss(@currentUser)', { ...CONFIG, routes: [{ name: 'manyBoss', returns: 'USER?', body: 'singleOrNull(@@Sales)' }] })).toBe(
            'eval.notExactlyOne'
        );
    });
});

describe('the functions', () => {
    test('findUser and specialUser do not repeat the key in an error', async () => {
        const result = await run("findUser('private@example.com')");
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.userNotFound' } });
        expect(JSON.stringify(result)).not.toContain('private@example.com');
    });

    test('a host function that returns users is checked against its declared type', async () => {
        const mine = (returned: unknown) => () => ({
            declarations: [{ name: 'someone', params: [], returns: 'USER' }],
            functions: { call: () => returned }
        });
        // An id text is a user.
        expect(await run('someone().name', CONFIG, mine('usr_ali'))).toMatchObject({ ok: true, value: 'Ali' });
        // Anything else is refused, and the program never sees it.
        for (const bad of [42, {}, ['usr_ali'], '', null]) {
            expect(await run('someone().name', CONFIG, mine(bad))).toMatchObject({ ok: false, error: { code: 'eval.hostFunctionResult' } });
        }
    });

    test('a host function that returns a set of users as a list of ids', async () => {
        const mine = () => ({
            declarations: [{ name: 'friends', params: [], returns: 'USERGROUP' }],
            functions: { call: () => ['usr_ali', 'usr_sara'] }
        });
        expect(await run('COUNT(friends())', CONFIG, mine)).toMatchObject({ ok: true, value: 2 });
        expect(await run('@currentUser IN friends()', CONFIG, mine)).toMatchObject({ ok: true, value: true });
    });
});

describe('the fixture directory', () => {
    test('system groups, nesting, tags and users who left', async () => {
        const dir = new FixtureDirectory({
            users: [
                { id: 'usr_1', name: 'One', role: 'admin' },
                { id: 'usr_2', name: 'Two', role: 'viewer' },
                { id: 'usr_3', name: 'Three', left: true, email: 'three@example.com' },
                { id: 'app_1', name: 'Bot', kind: 'application' }
            ],
            groups: [
                { name: 'Inner', members: ['usr_2', 'usr_3'], includes: [], tags: [] },
                { name: 'Outer', members: ['usr_1'], includes: ['Inner'], tags: ['team'] }
            ],
            routes: [],
            specialUsers: {}
        });
        const everyone = await dir.findGroup('everyone');
        expect((await dir.members(everyone!.id, undefined)).ids.sort()).toEqual(['usr_1', 'usr_2']);
        expect((await dir.members((await dir.findGroup('applications'))!.id, undefined)).ids).toEqual(['app_1']);
        expect((await dir.members((await dir.findGroup('admins'))!.id, undefined)).ids).toEqual(['usr_1']);
        expect((await dir.members((await dir.findGroup('Outer'))!.id, undefined)).ids.sort()).toEqual(['usr_1', 'usr_2']);
        expect((await dir.findGroup('Outer'))!.tags).toEqual(['team']);
        // Someone who left keeps the id and the name, and has no other column.
        expect(await dir.resolveUsers(['usr_3', 'usr_x'])).toMatchObject([
            { id: 'usr_3', name: 'Three', email: null },
            { id: 'usr_x', name: null }
        ]);
        expect(await dir.isMember('usr_3', everyone!.id)).toBe(false);
        expect(await dir.findUser('three@example.com')).toBeNull();
        expect(await dir.findGroup('Missing')).toBeNull();
        dir.close();
    });

    test('a page of members has a cursor', async () => {
        const users = Array.from({ length: 1200 }, (_, i) => ({ id: `usr_${i}`, name: `User ${i}` }));
        const dir = new FixtureDirectory({ users, groups: [], routes: [], specialUsers: {} });
        const everyone = (await dir.findGroup('everyone'))!.id;
        const first = await dir.members(everyone, undefined);
        const second = await dir.members(everyone, first.next);
        const third = await dir.members(everyone, second.next);
        expect([first.ids.length, second.ids.length, third.ids.length, third.next]).toEqual([500, 500, 200, undefined]);
    });
});

describe('the directory section of a config', () => {
    test('a config with a directory is parsed', () => {
        const config = parseConfig({
            directory: {
                users: [{ id: 'usr_1', name: 'One', city: 'Tabriz' }],
                groups: [{ name: 'G', members: ['usr_1'], tags: ['team'] }],
                routes: [{ name: 'boss', body: '@@G' }],
                specialUsers: { currentUser: 'usr_1', flowStarter: null }
            }
        });
        expect(config.directory).toEqual({
            users: [{ id: 'usr_1', name: 'One', city: 'Tabriz' }],
            groups: [{ name: 'G', members: ['usr_1'], includes: [], tags: ['team'] }],
            routes: [{ name: 'boss', returns: 'USERGROUP', body: '@@G' }],
            specialUsers: { currentUser: 'usr_1', flowStarter: null }
        });
        expect(parseConfig({}).directory).toBeUndefined();
    });

    test.each([
        [{ users: [{ id: 'a' }] }, 'users[0].name'],
        [
            {
                users: [
                    { id: 'a', name: 'A' },
                    { id: 'a', name: 'B' }
                ]
            },
            'used twice'
        ],
        [{ users: [{ id: 'a', name: 'A', age: 3 }] }, 'users[0].age: expected text or null'],
        [{ users: [{ id: 'a', name: 'A' }], groups: [{ name: 'G', members: ['b'] }] }, 'no user "b"'],
        [{ groups: [{ name: 'G', includes: ['H'] }] }, 'unknown group "H"'],
        [{ groups: [{ name: 'G' }, { name: 'G' }] }, 'a group name is used twice'],
        [{ routes: [{ name: 'Boss', body: 'x' }] }, 'camelCase'],
        [{ routes: [{ name: 'boss', returns: 'USER', body: 'x' }] }, '"USERGROUP" or "USER?"'],
        [{ specialUsers: { currentUser: 'nobody' } }, 'specialUsers.currentUser'],
        ['text', 'expected an object']
    ])('a bad section is refused: %j', (spec, message) => {
        expect(() => parseDirectory(spec, 'directory')).toThrow(ConfigError);
        expect(() => parseDirectory(spec, 'directory')).toThrow(message);
    });
});

describe('minab run with a directory section', () => {
    async function cli(program: string): Promise<{ code: number; out: string; err: string }> {
        const dir = mkdtempSync(join(tmpdir(), 'minab-directory-'));
        try {
            writeFileSync(join(dir, 'minab.config.json'), JSON.stringify({ directory: CONFIG }));
            writeFileSync(join(dir, 'rule.minab'), program);
            const out: string[] = [];
            const err: string[] = [];
            const io: CliIo = { cwd: dir, out: text => out.push(text), err: text => err.push(text) };
            const code = await runCli(['run', 'rule.minab'], io);
            return { code, out: out.join('\n'), err: err.join('\n') };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    test('users, groups, routes and the special users run from the config', async () => {
        expect(await cli('@currentUser IN @@Sales')).toMatchObject({ code: EXIT_OK, out: 'true' });
        expect(await cli('COUNT(teamLeader(@currentUser))')).toMatchObject({ code: EXIT_OK, out: '1' });
    });

    test('a failure is reported with its code', async () => {
        const result = await cli("findUser('nobody@example.com')");
        expect(result.code).toBe(EXIT_PROGRAM_ERROR);
        expect(result.err).toContain('no user found');
    });
});
