import { EmptyFileSystem } from 'langium';
import { describe, expect, test } from 'vitest';
import { complete, hover, inlayHints, parseDocument, pinnedUsers, quickFixes, semanticTokens, type EditorHints } from '../../src/editor/index.js';
import { resolveHostDeclarations } from '../../src/language/host-declarations.js';
import { createMinabServices } from '../../src/language/minab-module.js';
import { scalarType, USER_TABLE, type MinabSchema } from '../../src/language/schema.js';
import { applyEdits, cursor, diagnose } from './support.js';

/** MN.4 (security plan): completion, hover, inlay hints and semantic tokens for users and groups. */

const text = (name: string, nullable = false) => ({ name, type: { kind: 'scalar' as const, type: scalarType('TEXT', { nullable }) } });

const schema: MinabSchema = {
    version: 'editor-users',
    tables: [{ name: 'Task', primaryKey: 'id', columns: [text('id'), { name: 'owner', type: { kind: 'ref', table: USER_TABLE, nullable: true } }] }],
    directory: {
        user: [text('id'), text('name'), text('email', true), text('department', true), text('person:city', true)],
        group: [text('id'), text('name')]
    }
};

const host = resolveHostDeclarations(
    {
        functions: [
            { name: 'findUser', params: [{ name: 'key', type: 'TEXT' }], returns: 'USER' },
            {
                name: 'teamLeader',
                params: [{ name: 'u', type: 'USER' }],
                returns: 'USERGROUP',
                title: 'Team leader',
                description: 'The leaders of the teams a person is in.'
            }
        ]
    },
    schema
);

const services = createMinabServices(
    EmptyFileSystem,
    schema,
    {
        isFieldRule: false,
        recordTable: 'Task',
        specialUsers: [
            { name: 'currentUser', type: 'USER' },
            { name: 'appUser', type: 'USER?' }
        ],
        groupNames: ['Sales', 'Support', 'Sales team']
    },
    { mode: 'production', host }
).Minab;

const hints: EditorHints = {
    groups: [{ name: 'Sales', title: 'Sales people', kind: 'static' }, { name: 'Support' }, { name: 'Sales team', kind: 'dynamic' }],
    userLabels: { usr_5h2m: { name: 'Sara Ahmadi', email: 'sara@example.com' }, usr_gone: { name: null } }
};

async function items(marked: string, withHints = hints) {
    const { source, offset } = cursor(marked);
    return (await complete(parseDocument(services, source, withHints), offset)).items;
}

describe('completion after @ and @@', () => {
    test('@@Sa offers the groups of the host, and a name with a space goes in backticks', async () => {
        const found = await items('@@Sa|');
        expect(found.map(i => i.label)).toEqual(['Sales', 'Support', 'Sales team']);
        expect(found.find(i => i.label === 'Sales team')).toMatchObject({ detail: 'USERGROUP', insertText: '`Sales team`' });
        expect(found.find(i => i.label === 'Sales')).toMatchObject({ documentation: 'Sales people · kind: static' });
        expect(found.find(i => i.label === 'Sales')?.insertText).toBeUndefined();
    });

    test('without the host callback the plain list of the rule context is used', async () => {
        const { source, offset } = cursor('@@|');
        const found = (await complete(parseDocument(services, source), offset)).items;
        expect(found.map(i => i.label)).toEqual(['Sales', 'Support', 'Sales team']);
    });

    test('a backtick being typed is replaced as a whole', async () => {
        const { source, offset } = cursor('@@`Sales t|');
        const result = await complete(parseDocument(services, source, hints), offset);
        expect(result.replace).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 10 } });
    });

    test('@ offers the special users of the place, with their types', async () => {
        const found = await items('@|');
        expect(found.map(i => [i.label, i.detail])).toEqual([
            ['currentUser', 'USER'],
            ['appUser', 'USER?']
        ]);
    });

    test('a user value offers the directory columns, and a scoped attribute in backticks', async () => {
        const found = await items('@currentUser.|');
        expect(found.map(i => i.label)).toEqual(['id', 'name', 'email', 'department', 'person:city']);
        expect(found.find(i => i.label === 'person:city')?.insertText).toBe('`person:city`');
        expect((await items('FROM Task WHERE .owner.|')).map(i => i.label)).toContain('department');
        expect((await items('@@Sales[.|')).map(i => i.label)).toContain('department');
    });

    test('the host functions and routes are in the function list with their docs', async () => {
        const found = await items('t|');
        const route = found.find(i => i.label === 'teamLeader');
        expect(route).toMatchObject({ kind: 'hostFunction', detail: 'teamLeader(u: USER) → USERGROUP' });
        expect(route?.documentation).toContain('**Team leader**');
        expect(route?.documentation).toContain('The leaders of the teams a person is in.');
        expect(found.find(i => i.label === 'findUser')?.documentation).toBe('A function of the host. A program that calls it needs the server.');
    });
});

describe('hover', () => {
    const at = (marked: string, withHints: EditorHints = hints) => {
        const { source, offset } = cursor(marked);
        return hover(parseDocument(services, source, withHints), offset);
    };

    test('@@Sales is a USERGROUP, with the title of the group', () => {
        const result = at('@@Sa|les');
        expect(result?.contents).toContain('`@@Sales`');
        expect(result?.contents).toContain('Sales people');
        expect(result?.contents).toContain('**type** `USERGROUP`');
    });

    test('@currentUser is a USER, and @appUser a USER?', () => {
        expect(at('@curr|entUser')?.contents).toContain('**type** `USER`');
        expect(at('@app|User')?.contents).toContain('**type** `USER?`');
    });

    test('a route call shows the title and the description of the host', () => {
        const result = at('teamLea|der(@currentUser)');
        expect(result?.contents).toContain('teamLeader(u: USER) → USERGROUP');
        expect(result?.contents).toContain('**Team leader**');
    });

    test("a pinned findUser('usr_…') shows the member; an unknown id keeps the plain hover", () => {
        expect(at("findUser('usr_5h|2m')")?.contents).toContain('**Sara Ahmadi · sara@example.com**');
        expect(at("find|User('usr_5h2m')")?.contents).toContain('**Sara Ahmadi · sara@example.com**');
        expect(at("findUser('usr_un|known')")?.contents).not.toContain('Sara');
        expect(at("findUser('usr_5h|2m')", {})?.contents ?? '').not.toContain('Sara');
    });
});

describe('inlay hints', () => {
    const pins = (source: string) => pinnedUsers(parseDocument(services, source));

    test('only a findUser with a usr_ id key is pinned', () => {
        expect(pins("findUser('usr_5h2m') == findUser('sara@example.com')").map(p => p.id)).toEqual(['usr_5h2m']);
        expect(pins('let k = "usr_1"; findUser(k)')).toEqual([]);
    });

    test('the hint is the name and the e-mail, after the call', () => {
        const source = ".owner == findUser('usr_5h2m')";
        expect(inlayHints(pins(source), hints.userLabels!)).toEqual([
            { position: { line: 0, character: source.length }, label: 'Sara Ahmadi · sara@example.com' }
        ]);
    });

    test('a member that left has no name: no hint, and the id is never shown as a name', () => {
        expect(inlayHints(pins("findUser('usr_gone')"), hints.userLabels!)).toEqual([]);
    });
});

describe('semantic tokens', () => {
    test('the sigils are operators; the names are a host variable and a host class', () => {
        const tokens = semanticTokens(parseDocument(services, '@currentUser IN @@Sales'));
        const shape = tokens.map(t => [t.character, t.length, t.type, ...t.modifiers]);
        expect(shape).toEqual(
            expect.arrayContaining([
                [0, 1, 'operator'],
                [1, 11, 'variable', 'host'],
                [16, 2, 'operator'],
                [18, 5, 'class', 'host']
            ])
        );
    });
});

describe('quick fixes for an unknown group and an unknown special user', () => {
    test('the diagnostic suggests the closest names, and the fix writes the whole reference again', async () => {
        const doc = parseDocument(services, '@@Salez');
        const fixes = quickFixes(doc, {
            code: 'scope.unknownGroup',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
            params: { name: 'Salez' }
        });
        expect(fixes.map(f => f.title)).toEqual(['Use @@Sales']);
        expect(applyEdits('@@Salez', fixes[0].edits)).toBe('@@Sales');
        const special = quickFixes(parseDocument(services, '@currentUsr'), {
            code: 'scope.unknownSpecialUser',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } },
            params: { name: 'currentUsr' }
        });
        expect(special.map(f => f.title)).toEqual(['Use @currentUser']);
        expect(applyEdits('@currentUsr', special[0].edits)).toBe('@currentUser');
    });

    test('the unknown names the checker finds carry the same suggestions', async () => {
        const found = await diagnose(services, '@@Salez');
        expect(found.map(d => d.message).join(' ')).toContain('did you mean');
        // The range of the diagnostic is the whole reference, which is what the fix replaces.
        expect(found[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 7 } });
    });
});
