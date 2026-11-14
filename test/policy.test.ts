/**
 * The policy profile and the policy compiler (MN.3, proposal P12): what the profile refuses, what each form compiles to,
 * and the golden corpus (`test/policy-ir/*.json`).
 *
 * A golden case is `{ name, source, kind, expected, ir, ... }`. The test runs the source in Minab's interpreter and compares
 * the answer with `expected` (written by a person, from the spec), and compiles the source and compares the IR with `ir` and
 * with `schemas/policy-ir.v1.json`. The Shamsine engine runs the same cases (EN.9). To rewrite the stored `ir` after a change
 * on purpose: `UPDATE_POLICY_IR=1 npm run corpus:check`, then read the diff.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FixtureDirectory, parseDirectory, type DirectoryConfig } from '../src/host/index.js';
import { parseScalar } from '../src/host/config.js';
import { createMinab, policyInputs, type MinabSchema, type PolicyOptions, type PreparedProgram } from '../src/runtime/index.js';
import type { MinabColumnSchema } from '../src/language/schema.js';
import { jsonSchemaErrors } from './support/json-schema.js';

const CORPUS = new URL('./policy-ir/', import.meta.url);
const irSchema = JSON.parse(readFileSync(new URL('../schemas/policy-ir.v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;

type Json = Record<string, unknown>;
const context = JSON.parse(readFileSync(new URL('_context.json', CORPUS), 'utf8')) as {
    record: Record<string, string>;
    newRecord: Record<string, string>;
    defaults: { now: string; request: Json; tags: Json; record: Json; new: Json; currentUser: string; appUser: string };
    tagKeys: string[];
    directory: unknown;
};

// ---- the host of a test -----------------------------------------------------------------------------------------------

function column(name: string, type: string): MinabColumnSchema {
    if (type === 'USER' || type === 'USER?') return { name, type: { kind: 'ref', table: '@USER', nullable: type === 'USER?' } };
    return { name, type: { kind: 'scalar', type: parseScalar(type, `record.${name}`) } };
}

interface Host {
    dir: FixtureDirectory;
    minab: ReturnType<typeof createMinab>;
    functions: ReturnType<FixtureDirectory['functions']>;
    options: PolicyOptions;
}

function host(
    directory: DirectoryConfig = parseDirectory(context.directory, 'directory'),
    extra: { functions?: Parameters<typeof createMinab>[0]['functions'] } = {}
): Host {
    const dir = new FixtureDirectory(directory);
    const functions = dir.functions();
    const schema: MinabSchema = {
        tables: [{ name: 'orders', primaryKey: 'id', columns: Object.entries(context.record).map(([name, type]) => column(name, type)) }],
        directory: dir.schema()
    };
    const minab = createMinab({
        schema,
        functions: [...functions.declarations, ...(extra.functions ?? [])],
        inputs: policyInputs(context.newRecord),
        ruleContext: { isFieldRule: false, recordTable: 'orders' }
    });
    return { dir, minab, functions, options: { groupNames: dir.groupNames, tagKeys: context.tagKeys, routes: directory.routes, appUser: true } };
}

const shared = host();

async function prepare(
    source: string,
    kind: 'boolean' | 'principal' | 'route',
    h: Host = shared,
    options: Partial<PolicyOptions> = {}
): Promise<PreparedProgram> {
    return await h.minab.prepare(source, { profile: 'policy', expect: kind, policy: { ...h.options, ...options } });
}

const codes = (program: PreparedProgram, severity: 'error' | 'warning' = 'error') => program.diagnostics.filter(d => d.severity === severity).map(d => d.code);

async function compile(source: string, kind: 'boolean' | 'principal' | 'route' = 'boolean', h: Host = shared, options: Partial<PolicyOptions> = {}) {
    const program = await prepare(source, kind, h, options);
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    return await program.compilePolicy({ directory: h.dir });
}

// ---- the profile refuses ----------------------------------------------------------------------------------------------

describe('the policy profile refuses what is not allowed (P12)', () => {
    const host2 = host(undefined, { functions: [{ name: 'fxRate', params: [{ name: 'code', type: 'TEXT' }], returns: 'DECIMAL' }] });
    const refused: Array<[string, string]> = [
        ['a FROM query', 'FROM orders SELECT .id'],
        ['a FROM query as the tail after a condition', 'FROM orders WHERE .id == 7'],
        ['a "let" declaration', 'let x: INTEGER = 1; .id == x'],
        ['a function declaration', 'fn f(): BOOLEAN { true } f()'],
        ['a loop', 'loop i from 1 to 3 { } true'],
        ['a #Table name', 'COUNT(#orders) > 0'],
        ['a host function that is not a directory function', "fxRate('USD') > 1"],
        ['specialUser', "specialUser('currentUser') == @currentUser"],
        ['findUser with a key that is not a literal', '.owner == findUser(.status)'],
        ['findGroup with a name that is not a literal', '@currentUser IN findGroup(.status)'],
        ['LOG', 'LOG(.id) == 7'],
        ['an "if"', 'if .id == 7 { true } else { false }'],
        ['a "switch"', "switch .status { 'open' => true, _ => false }"],
        ['arithmetic', '.id + 1 == 8'],
        ['a CAST other than DATE', '.id == CAST(.status AS INTEGER)'],
        ['the whole record', '. is null'],
        ['null in a comparison', '.note == null'],
        ['an attribute of another user', ".owner.city == 'Marand'"],
        ['a JSON object', '{ a: 1 } is object'],
        ['COUNT', 'COUNT(@@Sales) > 1'],
        ['EXISTS', "EXISTS(@@Sales[.city == 'Tabriz'])"],
        ['the special user @appUser as a value', '@appUser.city == .status']
    ];
    for (const [what, source] of refused) {
        test(`${what}: ${source}`, async () => {
            const program = await prepare(source, 'boolean', host2);
            expect(program.ok).toBe(false);
            expect(codes(program)).toContain('policy.constructNotAllowed');
            const found = program.diagnostics.find(d => d.code === 'policy.constructNotAllowed');
            expect(found?.range.start.line).toBeGreaterThanOrEqual(0);
            expect(found?.message.length).toBeGreaterThan(0);
        });
    }

    test('the diagnostic has the range of the refused part', async () => {
        const program = await prepare("\n.id == 7 AND fxRateX('x') == 1", 'boolean');
        const refused = await prepare(".id == 7 AND specialUser('x') == @currentUser", 'boolean');
        expect(refused.diagnostics.find(d => d.code === 'policy.constructNotAllowed')?.range).toEqual({
            start: { line: 0, character: 13 },
            end: { line: 0, character: 29 }
        });
        // An unknown function is the checker's error, not the profile's.
        expect(codes(program)).not.toContain('policy.constructNotAllowed');
    });

    test('two refused parts are two diagnostics', async () => {
        const program = await prepare("COUNT(@@Sales) > 1 AND specialUser('x') == @currentUser", 'boolean');
        expect(codes(program).filter(code => code === 'policy.constructNotAllowed')).toHaveLength(2);
    });

    test('a route body may not read the special users', async () => {
        const program = await prepare('@currentUser IN @@Sales', 'route');
        expect(codes(program)).toContain('scope.unknownSpecialUser');
    });

    test('a route body is checked as a route: its range is in the source the host gave', async () => {
        const program = await prepare('\ngroupsOf(u).members & findUser(.x)', 'route', shared, { route: { returns: 'USERGROUP' } });
        const found = program.diagnostics.find(d => d.severity === 'error');
        expect(found?.range.start.line).toBe(1);
    });

    test('@appUser is a special user only when the host declares it', async () => {
        const program = await prepare('.owner == @appUser', 'boolean', shared, { appUser: false });
        expect(codes(program)).toContain('scope.unknownSpecialUser');
        expect(codes(await prepare('.owner == @appUser', 'boolean'))).toEqual([]);
    });

    test('an unknown @flowStarter is refused in a policy', async () => {
        expect(codes(await prepare('@flowStarter IN @@Sales', 'boolean'))).toContain('scope.unknownSpecialUser');
    });

    test('expect principal needs a user or a set of users', async () => {
        expect(codes(await prepare('.id == 7', 'principal'))).toContain('type.unexpectedResultType');
        expect(codes(await prepare("'x'", 'boolean'))).toContain('type.unexpectedResultType');
    });

    test('expect route needs the declared return type', async () => {
        expect(codes(await prepare('singleOrNull(@@Sales)', 'route', shared, { route: { returns: 'USERGROUP' } }))).toContain('type.unexpectedResultType');
        expect(codes(await prepare('singleOrNull(@@Sales)', 'route', shared, { route: { returns: 'USER?' } }))).toEqual([]);
        expect(codes(await prepare('@@Sales', 'route'))).toEqual([]);
    });

    test('profile policy needs expect', async () => {
        await expect(shared.minab.prepare('true', { profile: 'policy' })).rejects.toThrow(TypeError);
        await expect(shared.minab.prepare('true', { profile: 'policy', expect: 'text' })).rejects.toThrow(TypeError);
    });

    test('compilePolicy needs a program prepared with the profile', async () => {
        const program = await shared.minab.prepare('true');
        await expect(program.compilePolicy()).rejects.toThrow(TypeError);
    });

    test('a program with errors is not compiled', async () => {
        const program = await prepare('FROM orders', 'boolean');
        const result = await program.compilePolicy();
        expect(result).toMatchObject({ ok: false, error: { code: 'compile.programHasErrors' } });
    });
});

describe('route calls nest at most 3 deep (P7, policy.tooManySteps)', () => {
    test('three levels are allowed', async () => {
        const program = await prepare('@currentUser == deputy(deputy(deputy(.owner)))', 'boolean');
        expect(codes(program)).toEqual([]);
    });

    test('a fourth level is policy.tooManySteps', async () => {
        const program = await prepare('@currentUser == deputy(deputy(deputy(deputy(.owner))))', 'boolean');
        expect(codes(program)).toEqual(['policy.tooManySteps']);
        expect(program.diagnostics[0].params).toMatchObject({ name: 'deputy', limit: 3 });
    });

    test('a route that takes a route in a set position counts too', async () => {
        const program = await prepare('@currentUser IN teamLeader(deputy(deputy(deputy(.owner))))', 'boolean');
        expect(codes(program)).toEqual(['policy.tooManySteps']);
    });
});

describe('resource.tags.<key> (P12)', () => {
    test('a key the workspace does not use is a warning with the closest keys', async () => {
        const program = await prepare("resource.tags.sensitivty == 'high'", 'boolean');
        expect(program.ok).toBe(true);
        const warning = program.diagnostics.find(d => d.code === 'policy.unknownTagKey');
        expect(warning).toMatchObject({ severity: 'warning', params: { key: 'sensitivty', suggestions: '"sensitivity"' } });
        expect(warning?.message).toContain('sensitivity');
    });

    test('a known key has no warning, and with no list nothing is checked', async () => {
        expect(codes(await prepare("resource.tags.sensitivity == 'high'", 'boolean'), 'warning')).toEqual([]);
        const program = await prepare("resource.tags.whatever == 'x'", 'boolean', shared, { tagKeys: undefined });
        expect(program.diagnostics).toEqual([]);
    });

    test('it compiles to { tag }, with the key in reads', async () => {
        const result = await compile("resource.tags.sensitivity == 'high'");
        expect(result).toMatchObject({
            ok: true,
            ir: { v: 1, condition: { op: 'cmp', cmp: 'eq', l: { tag: 'sensitivity' }, r: { lit: 'high', t: 'TEXT' } } },
            reads: { tags: ['sensitivity'] }
        });
    });

    test('request.tagKey is a request value', async () => {
        const result = await compile("request.tagKey == 'sensitivity'");
        expect(result).toMatchObject({ ok: true, ir: { condition: { l: { req: 'tagKey' } } } });
    });
});

// ---- what each form compiles to ---------------------------------------------------------------------------------------

describe('compilePolicy', () => {
    test('scenario 1: an or of a cmp and a member', async () => {
        const result = await compile('.owner == @currentUser OR @currentUser IN @@Managers');
        expect(result).toEqual({
            ok: true,
            ir: {
                v: 1,
                condition: {
                    op: 'or',
                    of: [
                        { op: 'cmp', cmp: 'eq', l: { res: ['owner'] }, r: { prin: ['id'] } },
                        { op: 'member', user: { special: 'currentUser' }, set: { k: 'group', id: 'grp_Managers' } }
                    ]
                }
            },
            reads: { groups: ['grp_Managers'], attributes: [], routes: [], tags: [] },
            pinnedSource: '.owner == @currentUser OR @currentUser IN @@Managers'
        });
    });

    test('scenario 3: a member of a route node', async () => {
        const result = await compile('@currentUser IN teamLeader(.owner)');
        expect(result).toMatchObject({
            ok: true,
            ir: { condition: { op: 'member', user: { special: 'currentUser' }, set: { k: 'route', name: 'teamLeader', arg: { res: ['owner'] } } } },
            reads: { routes: ['teamLeader'] }
        });
    });

    test('NOT is kept, and a constant folds', async () => {
        expect(await compile(".status != 'x' AND NOT .urgent")).toMatchObject({
            ir: {
                condition: {
                    op: 'and',
                    of: [
                        { op: 'cmp', cmp: 'ne' },
                        { op: 'not', x: { op: 'cmp', cmp: 'eq', l: { res: ['urgent'] } } }
                    ]
                }
            }
        });
        expect(await compile('NOT (true AND false)')).toMatchObject({ ir: { condition: { op: 'const', value: true } } });
        expect(await compile('.id == 1 OR true')).toMatchObject({ ir: { condition: { op: 'const', value: true } } });
    });

    test('literals carry their types, and a decimal keeps its digits', async () => {
        const result = await compile('.id == 7 AND .amount > 0.10 AND .id > -3 AND .urgent == true');
        expect(result).toMatchObject({
            ir: {
                condition: {
                    of: [
                        { r: { lit: 7, t: 'INTEGER' } },
                        { r: { lit: '0.10', t: 'DECIMAL' } },
                        { r: { lit: -3, t: 'INTEGER' } },
                        { r: { lit: true, t: 'BOOLEAN' } }
                    ]
                }
            }
        });
    });

    test('a text literal next to a CITEXT field is a CITEXT literal', async () => {
        expect(await compile(".code == 'abc'")).toMatchObject({ ir: { condition: { l: { res: ['code'] }, r: { lit: 'abc', t: 'CITEXT' } } } });
        expect(await compile(".status == 'abc'")).toMatchObject({ ir: { condition: { r: { lit: 'abc', t: 'TEXT' } } } });
    });

    test('a date literal is a typed literal, and a date of a field is a DATE function', async () => {
        expect(await compile("CAST('2026-03-01' AS DATE) < .due")).toMatchObject({ ir: { condition: { l: { lit: '2026-03-01', t: 'DATE' } } } });
        expect(await compile('CAST(.dueText AS DATE) == .due')).toMatchObject({ ir: { condition: { l: { fn: 'DATE', args: [{ res: ['dueText'] }] } } } });
    });

    test('every built-in function of the IR', async () => {
        const result = await compile(
            "NOW() < .closesAt AND LOWER(.status) == 'a' AND UPPER(.status) == 'A' AND YEAR(.due) == 1 AND MONTH(.due) == 1 AND DAY(.due) == 1"
        );
        const names = (result as { ir: { condition: { of: Array<{ l: { fn: string } }> } } }).ir.condition.of.map(part => part.l.fn);
        expect(names).toEqual(['NOW', 'LOWER', 'UPPER', 'YEAR', 'MONTH', 'DAY']);
    });

    test('a user attribute read in a filter is a principal path, and is listed in reads', async () => {
        const result = await compile("@@everyone[.city == 'Marand']", 'principal');
        expect(result).toMatchObject({
            ir: { principal: { k: 'filter', set: { k: 'everyone' }, where: { l: { prin: ['city'] } } } },
            reads: { attributes: ['city'] }
        });
    });

    test('a set operator tree', async () => {
        const result = await compile('!@@Contractors + @@Sales & @@Support - @@Interns | @currentUser', 'principal');
        expect(result).toMatchObject({ ok: true, ir: { principal: { k: 'xor' } } });
    });

    test('groupsOf(user)[where].members', async () => {
        const result = await compile("groupsOf(@currentUser)['team' IN .tags].members", 'principal');
        expect(result).toMatchObject({
            ir: { principal: { k: 'groupsOf', user: { special: 'currentUser' }, where: { op: 'cmp', cmp: 'in', l: { lit: 'team' }, r: { res: ['tags'] } } } }
        });
    });

    test('a route body reads its user as the current user', async () => {
        const result = await compile("groupsOf(u)['team' IN .tags].members & @@TeamLeaders", 'route');
        expect(result).toMatchObject({
            ir: {
                principal: {
                    k: 'inter',
                    of: [
                        { k: 'groupsOf', user: { special: 'currentUser' } },
                        { k: 'group', id: 'grp_TeamLeaders' }
                    ]
                }
            }
        });
    });

    test('single and singleOrNull make a user', async () => {
        const result = await compile("@currentUser == singleOrNull(@@everyone[.city == 'Marand'])");
        expect(result).toMatchObject({
            ir: { condition: { op: 'member', user: { special: 'currentUser' }, set: { k: 'one', user: { k: 'single', orNull: true } } } }
        });
    });

    test('the system groups have their own nodes', async () => {
        const result = await compile('@currentUser IN @@everyone + @@owners + @@admins + @@members + @@operators + @@viewers + @@applications', 'boolean');
        expect(JSON.stringify(result)).toContain('{"k":"everyone"}');
        for (const name of ['owners', 'admins', 'members', 'operators', 'viewers', 'applications'])
            expect(JSON.stringify(result)).toContain(`{"k":"system","name":"${name}"}`);
        // Nothing asks the directory for a system group.
        const asked: string[] = [];
        const program = await prepare('@currentUser IN @@admins', 'boolean');
        const port = Object.assign(Object.create(shared.dir), {
            findGroup: async (name: string) => {
                asked.push(name);
                return null;
            }
        });
        await program.compilePolicy({ directory: port });
        expect(asked).toEqual([]);
    });

    test('a group is kept by its id, not its name', async () => {
        const result = await compile('@currentUser IN @@`Sales team`');
        expect(result).toMatchObject({ ir: { condition: { set: { k: 'group', id: 'grp_Sales team' } } } });
        expect(JSON.stringify(result)).not.toContain('"Sales team"');
    });

    test('a group that does not exist is eval.groupNotFound', async () => {
        const program = await prepare('@currentUser IN @@Sales2', 'boolean', shared, { groupNames: undefined });
        expect(program.ok).toBe(true);
        const result = await program.compilePolicy({ directory: shared.dir });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.groupNotFound', params: { name: 'Sales2' } } });
    });

    test('a user that does not exist is eval.userNotFound, without the key in the message', async () => {
        const program = await prepare("@currentUser == findUser('nobody@example.com')", 'boolean');
        const result = await program.compilePolicy({ directory: shared.dir });
        expect(result).toMatchObject({ ok: false, error: { code: 'eval.userNotFound', range: { start: { line: 0, character: 16 } } } });
        expect(JSON.stringify(result)).not.toContain('nobody@example.com');
    });

    test('a program that names a group needs a directory', async () => {
        const program = await prepare('@currentUser IN @@Sales', 'boolean');
        expect(await program.compilePolicy()).toMatchObject({ ok: false, error: { code: 'eval.failed' } });
        // A program that names nothing by text needs none.
        const plain = await prepare('.owner == @currentUser AND @currentUser IN @@admins', 'boolean');
        expect(await plain.compilePolicy()).toMatchObject({ ok: true });
    });

    test('the signal and the port get the call', async () => {
        const seen: AbortSignal[] = [];
        const program = await prepare("@currentUser IN @@Sales + findGroup('Support')", 'boolean');
        const controller = new AbortController();
        const dir = shared.dir;
        const port = Object.assign(Object.create(dir), {
            findGroup: async (name: string, c: { signal: AbortSignal }) => {
                seen.push(c.signal);
                return await dir.findGroup(name);
            }
        });
        await program.compilePolicy({ directory: port, signal: controller.signal });
        expect(seen).toHaveLength(2);
        expect(seen.every(signal => signal === controller.signal)).toBe(true);
    });
});

describe('pinnedSource (P4)', () => {
    test('scenario 4: a literal e-mail becomes the id and nothing else changes', async () => {
        const source = ".owner == findUser('sara@example.com')   OR  @currentUser IN @@Managers  // sara@example.com stays here";
        const result = await compile(source);
        expect(result).toMatchObject({ ok: true, ir: { condition: { of: [{ r: { lit: 'usr_sara', t: 'USER' } }, {}] } } });
        expect((result as { pinnedSource: string }).pinnedSource).toBe(
            source.replace('sara@example.com', 'usr_sara').replace('// usr_sara', '// sara@example.com')
        );
    });

    test('a phone key becomes the id, whatever way it was typed', async () => {
        for (const phone of ['09121234567', '+989121234567', '۰۹۱۲۱۲۳۴۵۶۷']) {
            const result = await compile(`@currentUser == findUser("${phone}")`);
            expect((result as { pinnedSource: string }).pinnedSource).toBe('@currentUser == findUser("usr_sara")');
        }
    });

    test('an id key is already pinned, and a second findUser is pinned too', async () => {
        const source = "findUser('usr_ali') + findUser('mina@example.com')";
        const result = await compile(source, 'principal');
        expect((result as { pinnedSource: string }).pinnedSource).toBe("findUser('usr_ali') + findUser('usr_mina')");
    });

    test('a program with no findUser is returned as it is', async () => {
        const source = '  @currentUser  IN @@Sales\n';
        expect(((await compile(source)) as { pinnedSource: string }).pinnedSource).toBe(source);
    });

    test('a route body is pinned in the text the host gave', async () => {
        const result = await compile("@@Sales + findUser('ali@example.com')", 'route');
        expect((result as { pinnedSource: string }).pinnedSource).toBe("@@Sales + findUser('usr_ali')");
    });

    test('the pinned source compiles to the same IR', async () => {
        const first = await compile("@currentUser == findUser('sara@example.com')");
        const second = await compile((first as { pinnedSource: string }).pinnedSource);
        expect((second as { ir: unknown }).ir).toEqual((first as { ir: unknown }).ir);
    });
});

// ---- the golden corpus ------------------------------------------------------------------------------------------------

interface Case {
    name: string;
    source: string;
    kind: 'boolean' | 'principal' | 'route';
    expected: unknown;
    ir?: unknown;
    directory?: unknown;
    request?: Json;
    record?: Json;
    new?: Json;
    tags?: Json;
    now?: string;
    currentUser?: string;
    appUser?: string;
    u?: string;
    returns?: 'USERGROUP' | 'USER?';
    /** Context values the request leaves out (`record.note`): Unknown for the engine. The interpreter does not run these cases. */
    unknown?: string[];
}

interface CorpusFile {
    topic: string;
    cases: Case[];
}

const files = readdirSync(CORPUS)
    .filter(name => name.endsWith('.json') && !name.startsWith('_'))
    .sort();
const corpus = files.map(name => ({ name, data: JSON.parse(readFileSync(new URL(name, CORPUS), 'utf8')) as CorpusFile }));
const update = process.env.UPDATE_POLICY_IR === '1';
const hosts = new Map<string, Host>();

function hostFor(directory: unknown): Host {
    if (directory === undefined) return shared;
    const key = JSON.stringify(directory);
    let found = hosts.get(key);
    if (!found) {
        found = host(parseDirectory(directory, 'case.directory'));
        hosts.set(key, found);
    }
    return found;
}

/** What the interpreter answered, as the corpus writes it: a boolean, or the sorted ids of the users, or one id or null. */
function normalize(kind: Case['kind'], value: unknown, returns: Case['returns']): unknown {
    if (kind === 'boolean') return value;
    const idOf = (row: unknown) => (row as { id: string }).id;
    if (Array.isArray(value)) return value.map(idOf).sort();
    if (value === null || value === undefined) return kind === 'route' && returns === 'USER?' ? null : [];
    return kind === 'route' && returns === 'USER?' ? idOf(value) : [idOf(value)];
}

async function run(testCase: Case, h: Host): Promise<unknown> {
    const defaults = context.defaults;
    const returns = testCase.returns ?? 'USERGROUP';
    const program = await prepare(testCase.source, testCase.kind, h, { route: { returns } });
    expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const specialUsers: Record<string, string | null> =
        testCase.kind === 'route'
            ? { routeUser: testCase.u ?? defaults.currentUser }
            : { currentUser: testCase.currentUser ?? defaults.currentUser, appUser: testCase.appUser ?? defaults.appUser };
    const result = await program.run(
        {
            record: { ...defaults.record, ...testCase.record },
            hostInputs: {
                request: { ...defaults.request, ...testCase.request },
                resource: { tags: { ...defaults.tags, ...testCase.tags } },
                new: { ...defaults.new, ...testCase.new }
            },
            specialUsers
        },
        { directory: h.dir, hostFunctions: h.functions.functions, clock: { now: () => new Date(testCase.now ?? defaults.now), timeZone: 'UTC' } }
    );
    if (!result.ok) throw new Error(`${testCase.name}: ${result.error.code}: ${result.error.message}`);
    return normalize(testCase.kind, result.value, returns);
}

describe('the golden corpus (test/policy-ir)', () => {
    test('it has at least 80 cases, every name is used once, and every kind and topic is there', () => {
        const all = corpus.flatMap(file => file.data.cases);
        expect(all.length).toBeGreaterThanOrEqual(80);
        const names = all.map(testCase => `${testCase.kind}: ${testCase.name}`);
        expect(new Set(names).size).toBe(names.length);
        expect(new Set(all.map(testCase => testCase.kind))).toEqual(new Set(['boolean', 'principal', 'route']));
    });

    for (const file of corpus) {
        describe(file.name, () => {
            for (const testCase of file.data.cases) {
                test(`${testCase.kind}: ${testCase.name}`, async () => {
                    const h = hostFor(testCase.directory);
                    if (testCase.unknown) expect([true, false, 'unknown']).toContain(testCase.expected);
                    // The interpreter's answer is what a person wrote from the spec. An Unknown value has no meaning in the interpreter.
                    else expect(await run(testCase, h)).toEqual(testCase.expected);
                    // The compiled IR is the stored one, and it is valid.
                    const returns = testCase.returns ?? 'USERGROUP';
                    const program = await prepare(testCase.source, testCase.kind, h, { route: { returns } });
                    const compiled = await program.compilePolicy({ directory: h.dir });
                    if (!compiled.ok) throw new Error(`${testCase.name}: ${compiled.error.code}: ${compiled.error.message}`);
                    expect(jsonSchemaErrors(irSchema, compiled.ir)).toEqual([]);
                    if (update) testCase.ir = compiled.ir;
                    else expect(compiled.ir).toEqual(testCase.ir);
                });
            }
        });
    }

    test.runIf(update)('the stored ir is rewritten', () => {
        for (const file of corpus) writeFileSync(new URL(file.name, CORPUS), JSON.stringify(file.data, null, 2) + '\n');
    });
});
