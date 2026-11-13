import { EmptyFileSystem } from 'langium';
import { parseHelper, validationHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Diagnostic } from 'vscode-languageserver-types';
import type { Expression, Model } from '../src/language/generated/ast.js';
import { resolveHostDeclarations, HostDeclarationError, type HostFunctionDeclaration } from '../src/language/host-declarations.js';
import { createMinabServices, type MinabServices } from '../src/language/minab-module.js';
import { createMinab } from '../src/runtime/index.js';
import { formatType, USER_TABLE } from '../src/language/minab-types.js';
import { scalarType, type MinabRuleContext, type MinabSchema } from '../src/language/schema.js';

/**
 * MN.1 (security plan): the types of users and groups. `USER` and `USERGROUP`, `@name`, `@@name`, the set operators,
 * membership, host functions with user types, and the directory record types. Checking only: no program runs here.
 */

const text = (name: string, options: { nullable?: boolean } = {}) => ({ name, type: { kind: 'scalar' as const, type: scalarType('TEXT', options) } });

const schema: MinabSchema = {
    tables: [
        {
            name: 'Task',
            columns: [
                text('id'),
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'owner', type: { kind: 'ref', table: USER_TABLE, nullable: false } },
                { name: 'reviewer', type: { kind: 'ref', table: USER_TABLE, nullable: true } },
                { name: 'assignees', type: { kind: 'collection', table: USER_TABLE } },
                { name: 'tags', type: { kind: 'scalar', type: scalarType('TEXT', { array: true }) } }
            ]
        },
        // A customer table that is called USER and a column called USER: the 1.0 names keep working next to the directory.
        { name: 'USER', columns: [text('id'), text('USER')] }
    ],
    directory: {
        user: [
            text('id'),
            text('name'),
            text('city', { nullable: true }),
            text('role'),
            text('email', { nullable: true }),
            text('department', { nullable: true }),
            { name: 'verified', type: { kind: 'scalar', type: scalarType('BOOLEAN') } },
            text('person:city', { nullable: true }),
            text('platform:employeeNo', { nullable: true }),
            { name: 'manager', type: { kind: 'ref', table: USER_TABLE, nullable: true } },
            { name: 'friends', type: { kind: 'collection', table: USER_TABLE } }
        ],
        group: [
            text('id'),
            text('name'),
            { name: 'tags', type: { kind: 'scalar', type: scalarType('TEXT', { array: true }) } },
            { name: 'members', type: { kind: 'collection', table: USER_TABLE } }
        ]
    }
};

const functions: HostFunctionDeclaration[] = [
    { name: 'findUser', params: [{ name: 'key', type: 'TEXT' }], returns: 'USER' },
    { name: 'findGroup', params: [{ name: 'name', type: 'TEXT' }], returns: 'USERGROUP' },
    { name: 'single', params: [{ name: 'set', type: 'USERGROUP' }], returns: 'USER' },
    { name: 'singleOrNull', params: [{ name: 'set', type: 'USERGROUP' }], returns: 'USER?' },
    { name: 'specialUser', params: [{ name: 'name', type: 'TEXT' }], returns: 'USER?' },
    { name: 'groupsOf', params: [{ name: 'u', type: 'USER' }], returns: 'GROUP[]' },
    { name: 'manager', params: [{ name: 'u', type: 'USER' }], returns: 'USER?' },
    { name: 'teamLeader', params: [{ name: 'u', type: 'USER' }], returns: 'USERGROUP' },
    { name: 'someUsers', params: [], returns: 'USER[]' },
    { name: 'firstGroup', params: [{ name: 'groups', type: 'GROUP[]' }], returns: 'GROUP?' }
];

const GROUPS = ['everyone', 'Sales', 'Support', 'Interns', 'Managers', 'TeamLeaders', 'Sales team'];

interface Setup {
    services: MinabServices;
    parse: ReturnType<typeof parseHelper<Model>>;
    validate: ReturnType<typeof validationHelper<Model>>;
}

function setup(context: MinabRuleContext, declared: HostFunctionDeclaration[] = functions): Setup {
    const host = resolveHostDeclarations({ functions: declared }, schema);
    const { Minab } = createMinabServices(EmptyFileSystem, schema, context, { host, mode: 'production' });
    return { services: Minab, parse: parseHelper<Model>(Minab), validate: validationHelper<Model>(Minab) };
}

const messageText = (d: Diagnostic): string => (typeof d.message === 'string' ? d.message : d.message.value);

let main: Setup;
let noGroupList: Setup;
let flow: Setup;

beforeAll(() => {
    main = setup({
        isFieldRule: false,
        recordTable: 'Task',
        specialUsers: [
            { name: 'currentUser', type: 'USER' },
            { name: 'appUser', type: 'USER' }
        ],
        groupNames: GROUPS
    });
    noGroupList = setup({ isFieldRule: false, recordTable: 'Task', specialUsers: [{ name: 'currentUser', type: 'USER' }] });
    flow = setup({
        isFieldRule: false,
        recordTable: 'Task',
        specialUsers: [
            { name: 'currentUser', type: 'USER' },
            { name: 'flowStarter', type: 'USER?' }
        ],
        groupNames: GROUPS
    });
});

/** The type of the program's expression, written as a program writes it (`USER`, `USERGROUP`, `BOOLEAN`…), or the code of the failure. */
async function typeOf(s: Setup, source: string): Promise<string> {
    const document = await s.parse(source);
    expect(
        [...document.parseResult.lexerErrors, ...document.parseResult.parserErrors].map(e => e.message),
        source
    ).toEqual([]);
    const result = s.services.typeChecker.inferType(document.parseResult.value.tail as Expression);
    return result.ok ? formatType(result.type) : `error ${result.code}`;
}

async function expectClean(s: Setup, source: string): Promise<void> {
    const { diagnostics } = await s.validate(source);
    expect(diagnostics.map(messageText), source).toEqual([]);
}

async function expectCode(s: Setup, source: string, code: string): Promise<Diagnostic> {
    const { diagnostics } = await s.validate(source);
    const found = diagnostics.find(d => d.code === code);
    expect(found, `${source}\n${diagnostics.map(d => `${d.code}: ${messageText(d)}`).join('\n')}`).toBeDefined();
    return found!;
}

describe('the types USER and USERGROUP (P1)', () => {
    test('a special user is a USER, a group is a USERGROUP', async () => {
        expect(await typeOf(main, '@currentUser')).toBe('USER');
        expect(await typeOf(main, '@@Sales')).toBe('USERGROUP');
        expect(await typeOf(main, '@@`Sales team`')).toBe('USERGROUP');
    });

    test('let, parameters and return types take them', async () => {
        await expectClean(main, 'let me: USER = @currentUser;\nlet sales: USERGROUP = @@Sales;\nlet n: INTEGER = COUNT(sales);\nn');
        await expectClean(main, 'fn leaderOf(u: USER): USERGROUP { teamLeader(u) }\nleaderOf(@currentUser)');
    });

    test('USER? may be null and USER may not', async () => {
        await expectClean(flow, 'let maybe: USER? = @flowStarter;\nlet none: USER? = null;\nmaybe');
        await expectCode(flow, 'let who: USER = @flowStarter;\nwho', 'type.initializerMismatch');
        await expectCode(main, 'let who: USER = null;\nwho', 'type.initializerMismatch');
    });

    test('a USERGROUP is never null', async () => {
        await expectCode(main, 'let g: USERGROUP = null;\ng', 'type.initializerMismatch');
    });

    test('an array of users is not a set of users, and CAST makes the set', async () => {
        expect(await typeOf(main, 'someUsers()')).toBe('USER[]');
        await expectCode(main, 'let g: USERGROUP = someUsers();\ng', 'type.initializerMismatch');
        await expectClean(main, 'let g: USERGROUP = CAST(someUsers() AS USERGROUP);\nlet list: USER[] = someUsers();\ng');
        expect(await typeOf(main, 'CAST(someUsers() AS USERGROUP)')).toBe('USERGROUP');
    });

    test('a function that takes a USER does not take a group or a text', async () => {
        await expectCode(main, 'manager(@@Sales)', 'call.argumentType');
        await expectCode(main, "manager('usr_x')", 'call.argumentType');
        expect(await typeOf(main, 'manager(@currentUser)')).toBe('USER?');
    });

    test('a USER compares only with a USER (P1)', async () => {
        await expectClean(main, '.owner == @currentUser');
        await expectClean(main, '.owner != .reviewer');
        const text = await expectCode(main, '.owner == "usr_x"', 'type.userComparedToText');
        expect(messageText(text)).toContain('USER');
        await expectCode(main, "'usr_x' != .owner", 'type.userComparedToText');
        await expectCode(main, '.owner == @@Sales', 'type.userComparedToText');
        await expectClean(main, '.owner.id == "usr_x"');
        await expectClean(main, ".owner == findUser('usr_x')");
        await expectClean(main, '.reviewer == null');
    });

    test('a USER has no order', async () => {
        await expectCode(main, '.owner < @currentUser', 'type.orderingNeedsOrderable');
    });
});

describe('set operators (P3)', () => {
    test('scenario 1: groups combine into a USERGROUP; a number is refused', async () => {
        expect(await typeOf(main, '@@Sales + @@Support - @@Interns')).toBe('USERGROUP');
        expect(await typeOf(main, '@@Sales + 1')).toBe('error type.setOperandType');
        await expectCode(main, '@@Sales + 1', 'type.setOperandType');
    });

    test('every operator, with a group or a user on each side', async () => {
        for (const operator of ['+', '-', '&', '|']) {
            expect(await typeOf(main, `@@Sales ${operator} @@Support`), operator).toBe('USERGROUP');
            expect(await typeOf(main, `@@Sales ${operator} @currentUser`), operator).toBe('USERGROUP');
            expect(await typeOf(main, `@currentUser ${operator} @appUser`), operator).toBe('USERGROUP');
        }
    });

    test('a user that may be missing counts as a set of one or of none', async () => {
        expect(await typeOf(flow, '@@Sales + @flowStarter')).toBe('USERGROUP');
        expect(await typeOf(flow, '@@Sales & @flowStarter')).toBe('USERGROUP');
    });

    test('an array of users, a text, a BOOLEAN, a number or null is not an operand', async () => {
        await expectCode(main, '@@Sales + someUsers()', 'type.setOperandType');
        await expectCode(main, "@@Sales - 'usr_x'", 'type.setOperandType');
        await expectCode(main, '@@Sales & (.total > 1)', 'type.setOperandType');
        await expectCode(main, '@@Sales | null', 'type.setOperandType');
        await expectCode(main, '.total & .total', 'type.setOperandType');
        await expectCode(main, '.total | 1', 'type.setOperandType');
    });

    test('numbers, texts and dates keep their + and -', async () => {
        expect(await typeOf(main, '.total + 1')).toBe('DECIMAL');
        expect(await typeOf(main, "'a' + 'b'")).toBe('TEXT');
        expect(await typeOf(main, '.total - 1')).toBe('DECIMAL');
    });

    test('the message names the operator and both types', async () => {
        const diagnostic = await expectCode(main, '@@Sales + 1', 'type.setOperandType');
        expect((diagnostic.data as { params: unknown }).params).toEqual({ operator: '+', left: 'USERGROUP', right: 'INTEGER' });
    });

    test('A + B & C types as A + (B & C)', async () => {
        expect(await typeOf(main, '@@Sales + @@Support & @@Interns')).toBe('USERGROUP');
        expect(await typeOf(main, '@@Sales + @@Support & 1')).toBe('error type.setOperandType');
    });
});

describe('the complement ! (P3)', () => {
    test('the complement of a group or of a user is a USERGROUP', async () => {
        expect(await typeOf(main, '!@@Interns')).toBe('USERGROUP');
        expect(await typeOf(main, '!@currentUser')).toBe('USERGROUP');
        expect(await typeOf(main, '!@@Sales & @@Support')).toBe('USERGROUP');
        expect(await typeOf(main, '@@Sales - !@@Interns')).toBe('USERGROUP');
        expect(await typeOf(main, '!(@@Sales + @@Support)')).toBe('USERGROUP');
        expect(await typeOf(flow, '!@flowStarter')).toBe('USERGROUP');
    });

    test('scenario 7: ! on a BOOLEAN is type.complementNeedsUsers and says "use NOT"', async () => {
        expect(await typeOf(main, '!(.total > 10)')).toBe('error type.complementNeedsUsers');
        const diagnostic = await expectCode(main, '!(.total > 10)', 'type.complementNeedsUsers');
        expect(messageText(diagnostic)).toContain('use NOT');
        await expectClean(main, 'NOT (.total > 10)');
    });

    test('! on a number or a text is refused too', async () => {
        const number = await expectCode(main, '!.total', 'type.complementNeedsUsers');
        expect(messageText(number)).not.toContain('use NOT');
        await expectCode(main, "!'a'", 'type.complementNeedsUsers');
    });

    test('a unary minus and plus on users are not the complement', async () => {
        await expectCode(main, '-@@Sales', 'type.unaryNeedsNumeric');
    });
});

describe('membership (P9)', () => {
    test('scenario 3: IN a group needs a USER on the left', async () => {
        expect(await typeOf(main, '@currentUser IN @@Sales')).toBe('BOOLEAN');
        expect(await typeOf(main, '"usr_x" IN @@Sales')).toBe('error type.inNeedsUser');
        await expectCode(main, '"usr_x" IN @@Sales', 'type.inNeedsUser');
        await expectCode(main, '.total IN @@Sales', 'type.inNeedsUser');
        await expectCode(main, "'usr_x' IN .assignees", 'type.inNeedsUser');
    });

    test('IN a union, a difference, a filter and a user column', async () => {
        await expectClean(main, '@currentUser IN @@Sales + @@Support - @@Interns');
        await expectClean(main, "@currentUser IN @@everyone[.city == 'Marand']");
        await expectClean(main, '@currentUser IN .assignees');
        await expectClean(main, '.owner IN @@Sales');
        await expectClean(main, '.owner IN teamLeader(@currentUser)');
        await expectClean(main, '@currentUser IN !@@Interns');
    });

    test('a USER or a USER? on the right is a set of one (or none)', async () => {
        expect(await typeOf(main, '@currentUser IN manager(.owner)')).toBe('BOOLEAN');
        expect(await typeOf(main, '@currentUser IN .owner')).toBe('BOOLEAN');
        expect(await typeOf(flow, '@currentUser IN @flowStarter')).toBe('BOOLEAN');
        await expectCode(main, '"usr_x" IN manager(.owner)', 'type.inNeedsUser');
    });

    test('a user is not looked up in a list of texts', async () => {
        await expectCode(main, "@currentUser IN ['usr_x', 'usr_y']", 'type.userComparedToText');
    });

    test('COUNT, EXISTS, ALL and ANY work on a group with no new rule', async () => {
        expect(await typeOf(main, 'COUNT(@@Sales)')).toBe('INTEGER');
        expect(await typeOf(main, "EXISTS(@@Sales[.city == 'Tabriz'])")).toBe('BOOLEAN');
        expect(await typeOf(main, 'ALL(@@Sales.verified)')).toBe('BOOLEAN');
        expect(await typeOf(main, "ANY(@@Sales[.city == 'Tabriz'].verified)")).toBe('BOOLEAN');
        expect(await typeOf(main, 'COUNT(.assignees)')).toBe('INTEGER');
        await expectClean(main, 'let n: INTEGER = COUNT(@@Sales + @@Support);\nn');
    });
});

describe('the directory record types (P1, P6, P7)', () => {
    test('scenario 4: a filter types its columns from the directory schema', async () => {
        await expectClean(main, "@@everyone[.city == 'Marand']");
        expect(await typeOf(main, "@@everyone[.city == 'Marand']")).toBe('USERGROUP');
        await expectCode(main, "@@everyone[.cty == 'Marand']", 'scope.unknownColumn');
    });

    test('the unknown column names the table as a program reads it', async () => {
        const diagnostic = await expectCode(main, "@@everyone[.cty == 'Marand']", 'scope.unknownColumn');
        expect(messageText(diagnostic)).toContain('"USER"');
        expect(messageText(diagnostic)).not.toContain('@USER');
    });

    test('a filter on a column the directory has with the wrong type is an error', async () => {
        await expectCode(main, '@@everyone[.city == 1]', 'type.implicitCoercion');
    });

    test('.field on a group broadcasts, and on a user reads the column', async () => {
        expect(await typeOf(main, '@@Sales.city')).toBe('TEXT?[]');
        expect(await typeOf(main, '@currentUser.city')).toBe('TEXT?');
        expect(await typeOf(main, '@currentUser.manager')).toBe('USER?');
        expect(await typeOf(main, '@currentUser.manager.name')).toBe('TEXT');
        expect(await typeOf(main, '@@Sales.manager')).toBe('USERGROUP');
        expect(await typeOf(main, '@currentUser.friends')).toBe('USERGROUP');
        expect(await typeOf(main, '@@Sales.friends')).toBe('USERGROUP');
    });

    test('a user column of a dataset is a USER, and users a USERGROUP', async () => {
        expect(await typeOf(main, '.owner')).toBe('USER');
        expect(await typeOf(main, '.reviewer')).toBe('USER?');
        expect(await typeOf(main, '.assignees')).toBe('USERGROUP');
        expect(await typeOf(main, '.assignees[.city == "x"]')).toBe('USERGROUP');
        expect(await typeOf(main, '.owner.name')).toBe('TEXT');
        expect(await typeOf(main, '.owner.manager.id')).toBe('TEXT');
        await expectClean(main, '.assignees[.id != ^.owner.id]');
    });

    test('scoped attributes are ordinary columns with a backtick name, in a filter and on a USER (P6)', async () => {
        await expectClean(main, "@@everyone[.department == 'IT' AND .`person:city` == 'Marand']");
        await expectClean(main, ".owner.`platform:employeeNo` == 'E-1042'");
        expect(await typeOf(main, '@currentUser.`person:city`')).toBe('TEXT?');
        expect(await typeOf(main, '@@everyone.`person:city`')).toBe('TEXT?[]');
        await expectCode(main, "@@everyone[.`person:town` == 'x']", 'scope.unknownColumn');
    });

    test('a let, a filter of a let, a bracketed set and a call result keep the columns', async () => {
        await expectClean(main, "let g: USERGROUP = @@Sales;\ng[.city == 'Marand']");
        await expectClean(main, "(@@Sales + @@Support)[.city == 'Marand']");
        await expectClean(main, "single((@@Sales + @@Support)[.email LIKE '%@gmail.com'])");
        await expectClean(main, "teamLeader(@currentUser)[.city == 'Marand']");
        await expectClean(main, "fn pick(g: USERGROUP): USERGROUP { g[.city == 'x'] }\npick(@@Sales)");
        await expectCode(main, "(@@Sales + @@Support)[.cty == 'x']", 'scope.unknownColumn');
        await expectCode(main, "let g: USERGROUP = @@Sales;\ng[.cty == 'x']", 'scope.unknownColumn');
    });

    test('a default directory has the fixed columns of the spec', async () => {
        const plain = createMinabServices(EmptyFileSystem, { tables: [] }, { isFieldRule: false, specialUsers: [{ name: 'currentUser', type: 'USER' }] });
        const parse = parseHelper<Model>(plain.Minab);
        const typeCheck = async (source: string) => {
            const result = plain.Minab.typeChecker.inferType((await parse(source)).parseResult.value.tail as Expression);
            return result.ok ? formatType(result.type) : `error ${result.code}`;
        };
        expect(await typeCheck('@currentUser.name')).toBe('TEXT');
        expect(await typeCheck('@currentUser.email')).toBe('CITEXT?');
        expect(await typeCheck('@currentUser.joinedAt')).toBe('DATETIME');
        expect(await typeCheck('@currentUser.city')).toBe('error scope.unknownColumn');
    });

    test('the directory tables cannot be named by a program', async () => {
        await expectCode(main, 'FROM GROUP SELECT .id', 'scope.unknownTable');
        await expectCode(main, '#GROUP', 'scope.unknownAlias');
    });
});

describe('names and scope (P2, P8)', () => {
    test('scenario 5: @flowStarter is unknown where the host declares only currentUser and appUser', async () => {
        const diagnostic = await expectCode(main, '@flowStarter', 'scope.unknownSpecialUser');
        expect(messageText(diagnostic)).toContain('@flowStarter');
        expect(await typeOf(flow, '@flowStarter')).toBe('USER?');
    });

    test('scenario 5: @@Slaes suggests Sales', async () => {
        const diagnostic = await expectCode(main, '@@Slaes', 'scope.unknownGroup');
        expect(messageText(diagnostic)).toContain('"@@Sales"');
        expect((diagnostic.data as { params: { name: string; suggestions: string } }).params).toEqual({ name: 'Slaes', suggestions: '"@@Sales"' });
    });

    test('a far name has no suggestion, and a close special user is suggested', async () => {
        const group = await expectCode(main, '@@Nothing', 'scope.unknownGroup');
        expect(messageText(group)).not.toContain('did you mean');
        const user = await expectCode(main, '@currenUser', 'scope.unknownSpecialUser');
        expect(messageText(user)).toContain('"@currentUser"');
    });

    test('the suggestions are the closest names, at most three', async () => {
        const diagnostic = await expectCode(main, '@@Suport', 'scope.unknownGroup');
        expect((diagnostic.data as { params: { suggestions: string } }).params.suggestions).toBe('"@@Support"');
    });

    test('with no group list, @@ names are not checked (the host checks them when it saves)', async () => {
        await expectClean(noGroupList, '@@Anything');
        expect(await typeOf(noGroupList, '@@Anything')).toBe('USERGROUP');
    });

    test('with no special users declared, every @name is an error', async () => {
        const bare = setup({ isFieldRule: false, recordTable: 'Task' });
        await expectCode(bare, '@currentUser', 'scope.unknownSpecialUser');
    });

    test('a name with a backtick is checked as it reads', async () => {
        await expectClean(main, '@@`Sales team`');
        await expectCode(main, '@@`Sales squad`', 'scope.unknownGroup');
    });

    test('the group names are exact: another case is another name', async () => {
        await expectCode(main, '@@sales', 'scope.unknownGroup');
    });

    test('the plain host input currentUser is not a special user: @ is', async () => {
        await expectCode(main, 'currentUser', 'scope.unknownName');
    });
});

describe('host functions with user types (P4, P5, P7, P11)', () => {
    test('findUser, findGroup, single, singleOrNull and specialUser', async () => {
        expect(await typeOf(main, "findUser('hamed@example.com')")).toBe('USER');
        expect(await typeOf(main, "findGroup('Sales')")).toBe('USERGROUP');
        expect(await typeOf(main, "single(@@Sales[.city == 'Marand'])")).toBe('USER');
        expect(await typeOf(main, "singleOrNull(@@Interns[.email == 'a@b.c'])")).toBe('USER?');
        expect(await typeOf(main, "specialUser('flowStarter')")).toBe('USER?');
    });

    test('the brainstorm block of the proposal checks', async () => {
        await expectClean(
            main,
            [
                'let lazyUsers: USERGROUP = @@Sales;',
                "let activeName: TEXT = 'Support';",
                'let intersection: USERGROUP = lazyUsers & findGroup(activeName);',
                'let union: USERGROUP = lazyUsers + @@Support;',
                'let partial: USERGROUP = lazyUsers - @@Support;',
                'let exclusive: USERGROUP = lazyUsers | @@Support;',
                'let others: USERGROUP = !intersection;',
                "let subgroup: USERGROUP = intersection[.email LIKE '%@gmail.com'];",
                "let subgroup2: USERGROUP = @@Support[.email LIKE '%@gmail.com'];",
                "let userName: TEXT = 'flowStarter';",
                'let sameStarter: USER? = specialUser(userName);',
                "let aGroup: USERGROUP = @currentUser + findUser('hamed@example.com');",
                "let aUser: USER = findUser('usr_1');",
                "let fromGroup: USER = single(aGroup[.id == 'usr_1']);",
                "let fromBoth: USER = single((aGroup + @@Managers)[.email LIKE '%@gmail.com']);",
                'let leaders: USERGROUP = teamLeader(aUser) & @@TeamLeaders;',
                'leaders'
            ].join('\n')
        );
    });

    test('scenario 3: a route that gives USER? is a set of one in IN', async () => {
        await expectClean(main, '@currentUser IN manager(.owner)');
    });

    test('scenario 6: groupsOf gives GROUP[], and .members is the union of their members', async () => {
        expect(await typeOf(main, 'groupsOf(@currentUser)')).toBe('GROUP[]');
        expect(await typeOf(main, "groupsOf(@currentUser)['team' IN .tags]")).toBe('GROUP[]');
        expect(await typeOf(main, "groupsOf(@currentUser)['team' IN .tags].members")).toBe('USERGROUP');
        expect(await typeOf(main, "groupsOf(@currentUser)['team' IN .tags].members & @@TeamLeaders")).toBe('USERGROUP');
        await expectClean(main, "groupsOf(@currentUser)['team' IN .tags].members & @@TeamLeaders");
        await expectCode(main, "groupsOf(@currentUser)['team' IN .tag].members", 'scope.unknownColumn');
    });

    test('a route written in Minab as a function body checks the same way', async () => {
        await expectClean(
            main,
            [
                "fn teamMates(u: USER): USERGROUP { groupsOf(u)['team' IN .tags].members }",
                'fn lead(u: USER): USERGROUP { teamMates(u) & @@TeamLeaders }',
                '@currentUser IN lead(.owner)'
            ].join('\n')
        );
    });

    test('a GROUP record: a column of it, and a GROUP? result', async () => {
        expect(await typeOf(main, 'firstGroup(groupsOf(@currentUser))')).toBe('GROUP?');
        expect(await typeOf(main, 'firstGroup(groupsOf(@currentUser)).name')).toBe('TEXT');
        await expectCode(main, 'firstGroup(@@Sales)', 'call.argumentType');
    });

    test('the core adds none of them: without the declaration the function is unknown', async () => {
        const without = setup({ isFieldRule: false, recordTable: 'Task' }, []);
        await expectCode(without, "findUser('x')", 'call.unknownFunction');
        await expectCode(without, 'single(@@Sales)', 'call.unknownFunction');
    });

    test('a USERGROUP result does not take ? or [], and a made-up word is refused (a clear message at startup)', () => {
        for (const word of ['USERGROUP?', 'USERGROUP[]', 'USER[]?', 'USERS', 'GROUP[]?']) {
            expect(() => resolveHostDeclarations({ functions: [{ name: 'f', params: [], returns: word }] }, schema), word).toThrow(HostDeclarationError);
        }
        expect(() => resolveHostDeclarations({ functions: [{ name: 'f', params: [{ name: 'u', type: 'USERGROUP?' }], returns: 'TEXT' }] }, schema)).toThrow(
            /USERGROUP/
        );
    });

    test('a host input is still scalar or a record of scalars', () => {
        expect(() => resolveHostDeclarations({ inputs: { owner: 'USER' } }, schema)).toThrow(HostDeclarationError);
    });
});

describe('the 1.0 names keep working (the 1.x promise)', () => {
    test('a table, a column and a let called USER or USERGROUP still check', async () => {
        await expectClean(main, 'FROM USER WHERE .USER == "a" SELECT .id');
        await expectClean(main, 'let USER: TEXT = "a";\nlet USERGROUP: INTEGER = 1;\nUSER == "a" AND USERGROUP == 1');
        expect(await typeOf(main, '#USER')).toBe('collection<USER>');
    });

    test('text and number operators and the vivify bang are unchanged', async () => {
        expect(await typeOf(main, '.total != 1')).toBe('BOOLEAN');
        expect(await typeOf(main, "'a' + 'b'")).toBe('TEXT');
        expect(await typeOf(main, '1 + 2 * 3')).toBe('INTEGER');
    });
});

describe('through createMinab: the checker depends on the context', () => {
    const runtimeSchema = { tables: [] };

    test('two contexts that differ in their group names or special users never share a checker', async () => {
        const minab = createMinab({ schema: runtimeSchema });
        const sales = { isFieldRule: false, specialUsers: [{ name: 'currentUser', type: 'USER' as const }], groupNames: ['Sales'] };
        const support = { isFieldRule: false, specialUsers: [{ name: 'currentUser', type: 'USER' as const }], groupNames: ['Support'] };
        const flowStarter = { isFieldRule: false, specialUsers: [{ name: 'flowStarter', type: 'USER?' as const }], groupNames: ['Sales'] };
        const codesOf = async (source: string, ruleContext: MinabRuleContext) => (await minab.prepare(source, { ruleContext })).diagnostics.map(d => d.code);

        expect(await codesOf('@@Sales', sales)).toEqual([]);
        expect(await codesOf('@@Sales', support)).toEqual(['scope.unknownGroup']);
        expect(await codesOf('@@Support', support)).toEqual([]);
        expect(await codesOf('@@Support', sales)).toEqual(['scope.unknownGroup']);
        // The first context again: a cached checker must still answer for its own context.
        expect(await codesOf('@@Sales', sales)).toEqual([]);
        expect(await codesOf('@currentUser', sales)).toEqual([]);
        expect(await codesOf('@currentUser', flowStarter)).toEqual(['scope.unknownSpecialUser']);
        expect(await codesOf('@flowStarter', flowStarter)).toEqual([]);
        expect(minab.cacheStats().created).toBe(3);
    });

    test('a program with users is checked, has the result type, and a run refuses what is not evaluated yet', async () => {
        const minab = createMinab({ schema: runtimeSchema });
        const program = await minab.prepare('@@Sales', { ruleContext: { isFieldRule: false } });
        expect(program.ok).toBe(true);
        expect(program.resultType).toBe('USERGROUP');
        const complement = await minab.prepare('!@@Sales', { ruleContext: { isFieldRule: false } });
        expect(complement.ok).toBe(true);
        const result = await complement.run();
        expect(result.ok).toBe(false);
    });
});
