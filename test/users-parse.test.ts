import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { beforeAll, describe, expect, test } from 'vitest';
import { createMinabServices } from '../src/language/minab-module.js';
import type { Expression, Model } from '../src/language/generated/ast.js';

/**
 * MN.1 (security plan): the syntax of users and groups. `@name`, `@@name`,
 * the prefix `!`, and `&` and `|` as operators. Parsing only: what the forms
 * mean is in `users-types.test.ts`.
 */

let parse: ReturnType<typeof parseHelper<Model>>;

beforeAll(async () => {
    parse = parseHelper<Model>(createMinabServices(EmptyFileSystem).Minab);
});

async function parseClean(source: string): Promise<Model> {
    const doc = await parse(source);
    const problems = [...doc.parseResult.lexerErrors, ...doc.parseResult.parserErrors].map(e => e.message);
    expect(problems, `${source}\n${problems.join('\n')}`).toHaveLength(0);
    return doc.parseResult.value;
}

/** The tree of an expression with every operator in brackets, so a test can see the precedence. */
function show(node: Expression | undefined): string {
    if (node === undefined) return '?';
    switch (node.$type) {
        case 'BinaryExpression':
            return `(${show(node.left)} ${node.operator} ${show(node.right)})`;
        case 'UnaryExpression':
            return `(${node.negated ? 'NOT' : node.operator} ${show(node.operand)})`;
        case 'SpecialUserRef':
            return `@${node.name}`;
        case 'GroupRef':
            return `@@${node.name}`;
        case 'NameRef':
            return node.name;
        case 'CurrentRecord':
            return `.${node.field ?? ''}${node.vivify ? '!' : ''}`;
        case 'MemberAccess':
            return `${show(node.receiver)}.${node.member}${node.vivify ? '!' : ''}`;
        case 'FilterAccess':
            return `${show(node.receiver)}[${show(node.filter)}]`;
        case 'CallExpression':
            return `${show(node.callee)}(${node.args.map(show).join(', ')})`;
        case 'NumberLiteral':
            return String(node.value);
        case 'StringLiteral':
            return JSON.stringify(node.value);
        default:
            return node.$type;
    }
}

async function tree(source: string): Promise<string> {
    const model = await parseClean(source);
    return show(model.tail as Expression);
}

describe('names with a sigil', () => {
    test('@ names a special user', async () => {
        expect(await tree('@currentUser')).toBe('@currentUser');
    });

    test('@@ is one token: @@Sales is a group, not @ and @Sales', async () => {
        expect(await tree('@@Sales')).toBe('@@Sales');
        const model = await parseClean('@@Sales');
        expect(model.tail?.$type).toBe('GroupRef');
    });

    test('a backtick name after @@ and after @', async () => {
        expect(await tree('@@`Sales team`')).toBe('@@Sales team');
        expect(await tree('@`current user`')).toBe('@current user');
    });

    test('a name in another script, with a zero-width non-joiner', async () => {
        expect(await tree('@@فروش‌داخلی')).toBe('@@فروش‌داخلی');
    });

    test('after @ and @@ there is a name, never a text, a variable or an expression', async () => {
        for (const source of [`@'user'`, `@@'Sales'`, '@(a)', '@@(a)', '@', '@@', '@ 1']) {
            const doc = await parse(source);
            const problems = doc.parseResult.lexerErrors.length + doc.parseResult.parserErrors.length;
            expect(problems, source).toBeGreaterThan(0);
        }
    });

    test('a name can be read on the result: members, a filter, a call', async () => {
        expect(await tree('@currentUser.name')).toBe('@currentUser.name');
        expect(await tree(`@@everyone[.city == 'Marand']`)).toBe('@@everyone[(.city == "Marand")]');
        expect(await tree('single(@@Sales)')).toBe('single(@@Sales)');
        expect(await tree('COUNT(@@Sales)')).toBe('COUNT(@@Sales)');
    });
});

describe('the set operators and their precedence (P3)', () => {
    test('+ and - on groups, left to right', async () => {
        expect(await tree('@@Sales + @@Support - @@Interns')).toBe('((@@Sales + @@Support) - @@Interns)');
    });

    test('& binds like *, so A + B & C is A + (B & C)', async () => {
        expect(await tree('A + B & C')).toBe('(A + (B & C))');
        expect(await tree('A & B + C')).toBe('((A & B) + C)');
        expect(await tree('A - B & C')).toBe('(A - (B & C))');
    });

    test('| binds like +, left to right', async () => {
        expect(await tree('A | B | C')).toBe('((A | B) | C)');
        expect(await tree('A | B & C')).toBe('(A | (B & C))');
        expect(await tree('A + B | C - D')).toBe('(((A + B) | C) - D)');
    });

    test('& is left to right with * and /', async () => {
        expect(await tree('A & B * C')).toBe('((A & B) * C)');
        expect(await tree('A * B & C')).toBe('((A * B) & C)');
    });

    test('! is a prefix like the unary minus: !A & B is (!A) & B', async () => {
        expect(await tree('!A & B')).toBe('((! A) & B)');
        expect(await tree('!A + B')).toBe('((! A) + B)');
        expect(await tree('!!A')).toBe('(! (! A))');
        expect(await tree('-!A')).toBe('(- (! A))');
        expect(await tree('!@@Contractors')).toBe('(! @@Contractors)');
    });

    test('! after an operator', async () => {
        expect(await tree('x - !@@A')).toBe('(x - (! @@A))');
        expect(await tree('@@A & !@@B')).toBe('(@@A & (! @@B))');
    });

    test('! on a bracketed set and on a call', async () => {
        expect(await tree('!(@@A + @@B)')).toBe('(! (@@A + @@B))');
        expect(await tree('!findUser(x)')).toBe('(! findUser(x))');
    });

    test('a comparison and a membership around the operators', async () => {
        expect(await tree('@currentUser IN @@Sales + @@Support - @@Interns')).toBe('(@currentUser IN ((@@Sales + @@Support) - @@Interns))');
        expect(await tree('.owner == @currentUser OR @currentUser IN teamLeader(.owner)')).toBe(
            '((.owner == @currentUser) OR (@currentUser IN teamLeader(.owner)))'
        );
        expect(await tree('NOT @currentUser IN @@A')).toBe('(NOT (@currentUser IN @@A))');
    });
});

describe('the forms that already had a meaning keep it', () => {
    test('.a != b is still a comparison', async () => {
        expect(await tree('.a != b')).toBe('(.a != b)');
        expect(await tree('.a!=b')).toBe('(.a != b)');
    });

    test('.a! = b is a vivify followed by an assignment', async () => {
        const model = await parseClean('.a! = 1;');
        const statement = model.declarations[0];
        expect(statement.$type).toBe('AssignmentStatement');
        if (statement.$type === 'AssignmentStatement') {
            expect(show(statement.target)).toBe('.a!');
            expect(statement.operator).toBe('=');
        }
    });

    test('.doctor!.id = 21; still vivifies', async () => {
        const model = await parseClean('.doctor!.id = 21;');
        const statement = model.declarations[0];
        expect(statement.$type).toBe('AssignmentStatement');
        if (statement.$type === 'AssignmentStatement') expect(show(statement.target)).toBe('.doctor!.id');
    });

    test('if! is still the statement keyword', async () => {
        const model = await parseClean('if! true { x = 1; }');
        expect(model.declarations[0].$type).toBe('IfStatement');
    });

    test('x |= { a: 1 } is still the merge assignment, next to a | b', async () => {
        const model = await parseClean('x |= { a: 1 };');
        const statement = model.declarations[0];
        expect(statement.$type).toBe('AssignmentStatement');
        if (statement.$type === 'AssignmentStatement') expect(statement.operator).toBe('|=');
        expect(await tree('a | b')).toBe('(a | b)');
        const both = await parseClean('x |= { a: 1 };\na | b');
        expect(both.declarations).toHaveLength(1);
        expect(show(both.tail as Expression)).toBe('(a | b)');
    });

    test('SET { k :| { a: 1 } } is still the merge in a SET, next to a | b', async () => {
        const model = await parseClean('UPDATE #Customer WHERE .id == 1 SET { k :| { a: 1 }, n: a | b };');
        const statement = model.declarations[0];
        expect(statement.$type).toBe('UpdateStatement');
        if (statement.$type === 'UpdateStatement') {
            expect(statement.setClause.assignments.map(a => a.operator)).toEqual([':|', ':']);
            expect(show(statement.setClause.assignments[1].value)).toBe('(a | b)');
        }
    });

    test('x |= a | b: the merge takes a whole set expression', async () => {
        const model = await parseClean('x |= a | b;');
        const statement = model.declarations[0];
        if (statement.$type === 'AssignmentStatement') {
            expect(statement.operator).toBe('|=');
            expect(show(statement.value)).toBe('(a | b)');
        }
    });

    test('a number is still read with the unary minus, and the arithmetic is unchanged', async () => {
        expect(await tree('-1 + 2 * 3')).toBe('((- 1) + (2 * 3))');
        expect(await tree('a \\ b')).toBe('(a \\ b)');
    });
});

describe('USER and USERGROUP: type words that are still names (the 1.x promise)', () => {
    test('both are types', async () => {
        const model = await parseClean(
            'let me: USER = @currentUser;\nlet n: USER? = null;\nlet g: USERGROUP = @@Sales;\nlet arr: USER[] = x;\nlet z: USER[]? = null;'
        );
        const types = model.declarations.map(d => (d.$type === 'VariableDecl' && d.type.$type === 'TypeRef' ? d.type.base : undefined));
        expect(types).toEqual(['USER', 'USER', 'USERGROUP', 'USER', 'USER']);
    });

    test('a function can take and return them, and CAST can name them', async () => {
        await parseClean('fn teamLeader(u: USER): USERGROUP { @@Sales & @@Leaders }');
        await parseClean('CAST(x AS USERGROUP)');
    });

    test('a column, a let, a parameter, a table and an alias can still be named USER', async () => {
        expect(await tree('.USER')).toBe('.USER');
        expect(await tree('.USERGROUP.USER')).toBe('.USERGROUP.USER');
        expect(await tree('USER + 1')).toBe('(USER + 1)');
        expect(await tree('USERGROUP')).toBe('USERGROUP');
        expect(await tree('#USER')).toBe('NamedScope');
        await parseClean('let USER: TEXT = "a";\nlet USERGROUP: INTEGER = 1;');
        await parseClean('fn f(USER: TEXT): TEXT { USER }');
        await parseClean('FROM USER AS USERGROUP WHERE USERGROUP.USER == 1 SELECT .USER AS USER');
        await parseClean('FROM USERGROUP JOIN USER AS u ON u.USER == USERGROUP.USER');
        await parseClean('x = { USER: 1, USERGROUP: 2 };');
    });

    test('a longer name is a name: USERS and USER_ID', async () => {
        expect(await tree('USERS')).toBe('USERS');
        expect(await tree('USER_ID')).toBe('USER_ID');
    });

    test('a name written with a backtick still works', async () => {
        expect(await tree('.`USER`')).toBe('.USER');
    });
});
