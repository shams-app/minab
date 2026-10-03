/**
 * Production plan phase B1 — stable diagnostic codes (decision D35).
 *
 * Every entry of the registry (`src/language/diagnostics/codes.ts`) has one
 * small program here that makes the checker report that code. An entry with
 * no program fails the test, so the registry has no dead codes.
 *
 * Most programs go through the validator, the same way an editor sees them
 * (`via: 'validator'`). The validator reports a type failure only at the
 * node that began it, and only for some node types. A few failures start in
 * a node that has no check of its own (a `Block`, a `Subquery`, a bare name).
 * Those are tested at the type checker (`via: 'checker'`). Two scope
 * messages come only from the scope resolver (`via: 'resolver'`).
 * A compile refusal is tested at the SQL compiler (`via: 'compiler'`).
 * One entry is an evaluation error (`via: 'evaluation'`): the program runs in the interpreter.
 * Two entries are guards that the current grammar cannot reach; they are
 * tested with a hand-made node (`via: 'guard'`).
 * `type.unexpectedResultType` is made by the runtime's `expect` option, not by
 * the checker; `test/runtime.test.ts` tests it (`via: 'runtime'`). The two host
 * name codes need host declarations; `test/ports.test.ts` tests them.
 */

import { AstUtils, EmptyFileSystem, type AstNode } from 'langium';
import { validationHelper } from 'langium/test';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { createMinabServices, type MinabServices } from '../src/language/minab-module.js';
import { scalarType, type MinabRuleContext, type MinabSchema } from '../src/language/schema.js';
import { isMemberAccess, type Expression, type Model } from '../src/language/generated/ast.js';
import { DIAGNOSTICS, isDiagnosticCode, type DiagnosticCode } from '../src/language/diagnostics/codes.js';
import { DOC_PATH, renderDiagnosticsDoc } from '../scripts/diagnostics-doc.mjs';
import { EXIT_PROGRAM_ERROR, runCli, type CliIo } from '../src/cli/main.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const schema: MinabSchema = {
    tables: [
        {
            name: 'Customer',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'name', type: { kind: 'scalar', type: scalarType('TEXT') } },
                { name: 'tags', type: { kind: 'scalar', type: scalarType('JSON') } },
                { name: 'orders', type: { kind: 'collection', table: 'Order' } }
            ]
        },
        {
            name: 'Order',
            columns: [
                { name: 'id', type: { kind: 'scalar', type: scalarType('UUID') } },
                { name: 'customer', type: { kind: 'ref', table: 'Customer', nullable: false } },
                { name: 'total', type: { kind: 'scalar', type: scalarType('DECIMAL') } },
                { name: 'status', type: { kind: 'scalar', type: scalarType('TEXT') } }
            ]
        }
    ]
};

type Setting = 'record' | 'plain' | 'fieldWithoutType';

const SETTINGS: Record<Setting, MinabRuleContext> = {
    record: { isFieldRule: false, recordTable: 'Order' },
    plain: { isFieldRule: false },
    fieldWithoutType: { isFieldRule: true, recordTable: 'Order' }
};

/** The first node of the program for which `pick` is true. */
type Pick = (node: AstNode) => boolean;
const ofType =
    (type: string): Pick =>
    node =>
        node.$type === type;

type Case =
    | { via: 'validator'; program: string; setting?: Setting }
    | { via: 'checker'; program: string; target: Pick; setting?: Setting }
    | { via: 'resolver'; program: string; target: Pick; setting?: Setting }
    | { via: 'compiler'; program: string }
    | { via: 'runtime' }
    | { via: 'evaluation'; program: string }
    | { via: 'guard' };

/** One program per code. Keep it in the same order as the registry. */
const CASES: Record<DiagnosticCode, Case> = {
    'call.argumentType': { via: 'validator', program: 'fn f(a: INTEGER): INTEGER { a }\nf("x")' },
    'call.builtinArity': { via: 'validator', program: 'EXISTS(#Order, #Order)' },
    'call.builtinNeedsBooleanCollection': { via: 'validator', program: 'FROM Customer WHERE ALL(.orders.total) SELECT .id' },
    'call.builtinNeedsCollection': { via: 'validator', program: 'COUNT(1)' },
    'call.builtinNeedsNumericCollection': { via: 'validator', program: 'FROM Customer WHERE SUM(.orders.status) > 1 SELECT .id' },
    'call.builtinNeedsOrderableCollection': { via: 'validator', program: 'MIN(1)' },
    'call.calleeNotName': { via: 'validator', program: '.id(1)' },
    'call.functionNameCase': { via: 'validator', program: 'fn TAX(a: INTEGER): INTEGER { a }' },
    'call.unknownFunction': { via: 'validator', program: 'nope(1)' },
    'call.userArity': { via: 'validator', program: 'fn f(a: INTEGER): INTEGER { a }\nf(1, 2)' },
    'call.wrongArgumentCount': { via: 'validator', program: 'ROUND()' },

    cancelled: { via: 'runtime' }, // needs an AbortSignal: test/limits.test.ts

    'compile.blockInQuery': { via: 'compiler', program: 'FROM Order SELECT switch .status { "a" => { let x: INTEGER = 1; x }, _ => 2 } AS s' },

    'compile.hostFunctionInSql': { via: 'runtime' }, // needs host declarations: test/ports.test.ts
    'compile.nothingToCompile': { via: 'runtime' }, // test/runtime.test.ts
    'compile.notSql': { via: 'runtime' }, // test/run-errors.test.ts
    'compile.programHasErrors': { via: 'runtime' }, // test/runtime.test.ts

    'data.error': { via: 'runtime' }, // needs a failing data port: test/run-errors.test.ts
    'data.noPort': { via: 'runtime' }, // test/runtime.test.ts

    'eval.castFailed': { via: 'evaluation', program: 'CAST("12a" AS INTEGER)' },
    'eval.divisionByZero': { via: 'evaluation', program: '1 / 0' },
    'eval.failed': { via: 'runtime' }, // test/run-errors.test.ts
    'eval.hostFunctionFailed': { via: 'runtime' }, // needs host declarations: test/run-errors.test.ts
    'eval.hostFunctionMissing': { via: 'runtime' }, // needs host declarations: test/ports.test.ts
    'eval.integerOutOfRange': { via: 'evaluation', program: '9007199254740991 + 1' },
    'eval.missingInput': { via: 'runtime' }, // needs host declarations: test/ports.test.ts
    'eval.programInvalid': { via: 'runtime' }, // test/runtime.test.ts
    'eval.writesNotSupported': { via: 'runtime' }, // test/ports.test.ts

    'limit.callDepth': { via: 'runtime' }, // test/limits.test.ts
    'limit.sourceTooLong': { via: 'runtime' }, // test/limits.test.ts
    'limit.timeout': { via: 'runtime' }, // test/limits.test.ts
    'limit.tooDeep': { via: 'runtime' }, // test/limits.test.ts
    'limit.tooManyIterations': { via: 'runtime' }, // test/limits.test.ts
    'limit.tooManyRows': { via: 'runtime' }, // test/limits.test.ts
    'limit.tooManyStatements': { via: 'runtime' }, // test/limits.test.ts

    'null.likeWithNull': { via: 'validator', program: '.status LIKE null' },
    'null.optionalAssignNeedsNullable': { via: 'validator', program: 'let n: INTEGER = 1;\nn ?= 2;' },
    'null.orderingWithNull': { via: 'validator', program: '.total > null' },

    'query.functionReturnNotJson': { via: 'validator', program: 'fn f(a: INTEGER): INTEGER { FROM Order SELECT .id }' },
    'query.inSingleColumnRequired': { via: 'validator', program: '.id IN (FROM Order SELECT .id, .total)' },
    'query.singleColumnRequired': { via: 'checker', program: '(FROM Order SELECT .id, .total) == 1', target: ofType('Subquery') },

    'rule.fieldTypeMissing': { via: 'checker', program: '$', target: ofType('FieldValue'), setting: 'fieldWithoutType' },
    'rule.fieldValueOutsideFieldRule': { via: 'validator', program: '$ == 1' },

    'scope.assignToInput': { via: 'runtime' }, // needs host inputs: test/ports.test.ts
    'scope.columnNeedsTable': {
        via: 'resolver',
        program: 'EXISTS(#Order[^.id == .id])',
        target: node => isMemberAccess(node) && node.member === 'id' && node.receiver.$type === 'ParentRecord',
        setting: 'plain'
    },
    'scope.computedReceiver': { via: 'resolver', program: 'CAST(1 AS TEXT).size', target: ofType('MemberAccess') },
    'scope.currentRecordNoTable': { via: 'validator', program: 'FROM Nope SELECT .' },
    'scope.functionNameIsTable': { via: 'validator', program: 'fn Customer(a: INTEGER): INTEGER { a }' },
    'scope.keyInWrongClause': { via: 'validator', program: 'FROM Order WHERE KEY == 1 GROUPBY .id SELECT KEY' },
    'scope.keyOutsideQuery': { via: 'validator', program: 'KEY' },
    'scope.keyWithoutGroupBy': { via: 'validator', program: 'FROM Order SELECT KEY' },
    'scope.nameIsFunction': { via: 'validator', program: 'fn total(a: INTEGER): INTEGER { a }\nlet total: INTEGER = 5;' },
    'scope.nameIsHostName': { via: 'runtime' }, // needs host declarations: test/ports.test.ts
    'scope.noActiveScope': { via: 'guard' },
    'scope.noParentScope': { via: 'checker', program: '^', target: ofType('ParentRecord') },
    'scope.noStaticTable': { via: 'checker', program: 'FROM Order SELECT ^', target: ofType('ParentRecord'), setting: 'plain' },
    'scope.unknownAlias': { via: 'validator', program: '#Nope' },
    'scope.unknownColumn': { via: 'validator', program: 'FROM Order SELECT .bogus' },
    'scope.unknownName': { via: 'checker', program: 'x + 1', target: ofType('NameRef') },
    'scope.unknownTable': { via: 'checker', program: 'FROM Nope SELECT 1', target: ofType('TableRef') },

    'syntax.incompleteExpression': { via: 'validator', program: '.id >' },
    'syntax.lexer': { via: 'validator', program: '@@@' },
    'syntax.parser': { via: 'validator', program: 'FROM' },

    'type.arithmeticNeedsNumeric': { via: 'validator', program: '1 + true' },
    'type.assignMismatch': { via: 'validator', program: 'let n: INTEGER = 1;\nn = "x";' },
    'type.assignNeedsNumericTarget': { via: 'validator', program: 'let t: TEXT = "a";\nt -= 1;' },
    'type.blockNoValue': { via: 'checker', program: 'if true { }', target: ofType('IfExpr') },
    'type.cannotDetermine': { via: 'checker', program: 'FROM Nope AS n SELECT n', target: ofType('NameRef') },
    'type.cannotInfer': { via: 'guard' },
    'type.collectionAsGroupKey': { via: 'validator', program: 'FROM Customer GROUPBY .orders SELECT KEY' },
    'type.columnNeedsTable': { via: 'validator', program: 'FROM Nope SELECT .id' },
    'type.conditionNotBoolean': { via: 'validator', program: 'FROM Order WHERE .total SELECT .id' },
    'type.filterOnNonCollection': { via: 'validator', program: '1[true]' },
    'type.functionReturnMismatch': { via: 'validator', program: 'fn f(a: INTEGER): INTEGER { "x" }' },
    'type.ifBranchesDiffer': { via: 'validator', program: 'if true { 1 } else { "a" }' },
    'type.implicitCoercion': { via: 'validator', program: '.status == .total' },
    'type.inCollectionMismatch': { via: 'validator', program: '.total IN [1, 2] AND .status IN [1, 2]' },
    'type.inNeedsCollection': { via: 'validator', program: '.id IN 5' },
    'type.inSubqueryMismatch': { via: 'validator', program: '.status IN (FROM Order SELECT .total)' },
    'type.indexOnNonArray': { via: 'validator', program: 'let i: INTEGER = 1;\n.id[i]' },
    'type.indexOnNonTuple': { via: 'validator', program: '.id[0]' },
    'type.initializerMismatch': { via: 'validator', program: 'let t: TEXT = 1;' },
    'type.invalidFilter': { via: 'validator', program: '.id["x"]' },
    'type.likeNeedsText': { via: 'validator', program: '.total LIKE .total' },
    'type.listElementNotScalar': { via: 'validator', program: '[[1], 2] == [1]' },
    'type.listElementsMixed': { via: 'validator', program: '[1, "a"] == [1]' },
    'type.logicalNeedsBoolean': { via: 'validator', program: '1 AND 2' },
    'type.memberOnNonRecord': { via: 'validator', program: '.total.id' },
    'type.mergeAssignTarget': { via: 'validator', program: 'let n: INTEGER = 1;\nn |= 1;' },
    'type.notIterable': { via: 'checker', program: 'loop x in 5 { x }', target: node => node.$type === 'NameRef' && (node as { name?: string }).name === 'x' },
    'type.notNeedsBoolean': { via: 'validator', program: 'NOT 1' },
    'type.orderingNeedsOrderable': { via: 'validator', program: '.id > true' },
    'type.plusAssignTarget': { via: 'validator', program: 'let t: BOOLEAN = true;\nt += 1;' },
    'type.positionalIndexOnCollection': { via: 'validator', program: 'FROM Customer WHERE COUNT(.orders[2]) > 0 SELECT .id' },
    'type.switchArmsDiffer': { via: 'validator', program: 'switch .status { "a" => 1, _ => "x" }' },
    'type.tupleIndexOutOfBounds': { via: 'validator', program: '(1, 2)[5]' },
    'type.unaryNeedsNumeric': { via: 'validator', program: '-"a"' },
    'type.unexpectedResultType': { via: 'runtime' },
    'type.unsupportedOperator': { via: 'guard' }
};

let services: Record<Setting, MinabServices>;
let validate: Record<Setting, ReturnType<typeof validationHelper<Model>>>;

beforeAll(() => {
    services = {} as typeof services;
    validate = {} as typeof validate;
    for (const setting of Object.keys(SETTINGS) as Setting[]) {
        services[setting] = createMinabServices(EmptyFileSystem, schema, SETTINGS[setting]).Minab;
        validate[setting] = validationHelper<Model>(services[setting]);
    }
});

describe('the registry', () => {
    const codes = Object.keys(DIAGNOSTICS);

    test('is sorted by code', () => {
        expect(codes).toEqual([...codes].sort());
    });

    test.each(codes)('%s has the form <area>.<camelCaseName>, a message and an explanation', code => {
        expect(code).toMatch(/^((syntax|scope|type|null|call|compile|eval|limit|data|query|rule)\.[a-z][A-Za-z0-9]*|cancelled)$/);
        const entry = DIAGNOSTICS[code as DiagnosticCode];
        expect(entry.doc.length).toBeGreaterThan(10);
        expect(entry.doc.endsWith('.')).toBe(true);
    });

    test('every entry has a test program, and every test program has an entry (no dead codes)', () => {
        expect(Object.keys(CASES).sort()).toEqual([...codes].sort());
    });
});

describe('every code is reported by a program', () => {
    test.each(Object.entries(CASES))('%s', async (code, testCase) => {
        const expected = code as DiagnosticCode;
        switch (testCase.via) {
            case 'validator': {
                const setting = testCase.setting ?? 'record';
                const { diagnostics } = await validate[setting](testCase.program);
                const found = diagnostics.map(d => d.code);
                expect(found, `${testCase.program}\n${diagnostics.map(d => String(d.message)).join('\n')}`).toContain(expected);
                // The parameters travel with the diagnostic, so a host can translate the message.
                const diagnostic = diagnostics.find(d => d.code === expected)!;
                const params = (diagnostic.data as { params: Record<string, string | number> }).params;
                expect(params).toBeDefined();
                expect(String(diagnostic.message)).toBe(DIAGNOSTICS[expected].message(params as never));
                break;
            }
            case 'checker': {
                const setting = testCase.setting ?? 'record';
                const { document } = await validate[setting](testCase.program);
                const node = AstUtils.streamAst(document.parseResult.value).find(testCase.target);
                expect(node, 'the program has the node to infer').toBeDefined();
                const result = services[setting].typeChecker.inferType(node as Expression);
                expect(result.ok).toBe(false);
                if (!result.ok) {
                    expect(result.code).toBe(expected);
                    expect(result.reason).toBe(DIAGNOSTICS[expected].message(result.params as never));
                }
                break;
            }
            case 'resolver': {
                const setting = testCase.setting ?? 'record';
                const { document } = await validate[setting](testCase.program);
                const node = AstUtils.streamAst(document.parseResult.value).find(testCase.target);
                expect(node, 'the program has the node to resolve').toBeDefined();
                const result = services[setting].scopeResolver.resolveMemberAccess(node as never);
                expect(result.found).toBe(false);
                if (!result.found) {
                    expect(result.code).toBe(expected);
                    expect(result.reason).toBe(DIAGNOSTICS[expected].message(result.params as never));
                }
                break;
            }
            case 'compiler': {
                const { document } = await validate.record(testCase.program);
                const query = AstUtils.streamAst(document.parseResult.value).find(node => node.$type === 'Query');
                expect(query, 'the program has a query to compile').toBeDefined();
                const result = services.record.sqlCompiler.compileQuery(query as never);
                expect(result.ok).toBe(false);
                if (!result.ok) {
                    expect(result.code).toBe(expected);
                    expect(result.reason).toBe(DIAGNOSTICS[expected].message(result.params as never));
                }
                break;
            }
            case 'runtime':
                break; // tested in test/runtime.test.ts
            case 'evaluation': {
                // The error carries its code and the English message.
                const { document } = await validate.record(testCase.program);
                const result = await services.record.interpreter.evaluate(document.parseResult.value, { executor: { execute: async () => [] } });
                const params = (!result.ok && result.params) || {};
                expect(result).toMatchObject({ ok: false, code: expected, reason: DIAGNOSTICS[expected].message(params as never) });
                break;
            }
            case 'guard':
                break; // tested below, with a hand-made node
        }
    });

    // The grammar cannot produce these. They guard against a later grammar
    // change that adds a node or an operator the checker does not know yet.
    test('type.cannotInfer: a node type the checker has no rule for', () => {
        const result = services.record.typeChecker.inferType({ $type: 'Unknown' } as never);
        expect(result).toMatchObject({ ok: false, code: 'type.cannotInfer', params: { nodeType: 'Unknown' } });
    });

    test('type.unsupportedOperator: an operator the checker has no rule for', () => {
        const node = { $type: 'BinaryExpression', operator: '??', left: undefined, right: undefined } as never;
        const result = services.record.typeChecker.inferType(node);
        expect(result).toMatchObject({ ok: false, code: 'type.unsupportedOperator', params: { operator: '??' } });
    });

    test('scope.noActiveScope: a scope stack that is empty (the resolver always has a root level)', () => {
        const resolver = services.record.scopeResolver;
        vi.spyOn(resolver as unknown as { stackAt: () => unknown[] }, 'stackAt').mockReturnValue([]);
        try {
            const result = resolver.resolveCurrentRecordBase({ $type: 'CurrentRecord' } as never);
            expect(result).toMatchObject({ found: false, code: 'scope.noActiveScope' });
        } finally {
            vi.restoreAllMocks();
        }
    });
});

describe('the parameters name what went wrong', () => {
    test('comparing TEXT with DECIMAL is type.implicitCoercion and names both types', async () => {
        const { diagnostics } = await validate.record('.status == .total');
        const diagnostic = diagnostics.find(d => d.code === 'type.implicitCoercion');
        expect(diagnostic).toBeDefined();
        expect((diagnostic!.data as { params: unknown }).params).toEqual({ operator: '==', left: 'TEXT', right: 'DECIMAL' });
        expect(String(diagnostic!.message)).toBe('"==" between TEXT and DECIMAL requires an explicit CAST (no implicit coercion)');
    });

    test('a lexer error keeps its message as a parameter', async () => {
        const { diagnostics } = await validate.record('@@@');
        const diagnostic = diagnostics.find(d => d.code === 'syntax.lexer')!;
        expect((diagnostic.data as { params: unknown }).params).toEqual({ message: String(diagnostic.message) });
        // Langium's own marker stays, so the playground can still tell syntax errors apart.
        expect((diagnostic.data as { code: unknown }).code).toBe('lexing-error');
    });

    test('a parser error is syntax.parser', async () => {
        const { diagnostics } = await validate.record('FROM');
        expect(diagnostics.some(d => d.code === 'syntax.parser' && (d.data as { code: unknown }).code === 'parsing-error')).toBe(true);
    });

    test('isDiagnosticCode knows the registry', () => {
        expect(isDiagnosticCode('type.implicitCoercion')).toBe(true);
        expect(isDiagnosticCode('type.nope')).toBe(false);
        expect(isDiagnosticCode(undefined)).toBe(false);
    });
});

describe('docs/reference/diagnostics.md', () => {
    test('is up to date (run `npm run docs:diagnostics` to write it)', () => {
        expect(readFileSync(DOC_PATH, 'utf8')).toBe(renderDiagnosticsDoc(DIAGNOSTICS));
    });

    test('lists every code with its parameters', () => {
        const page = renderDiagnosticsDoc(DIAGNOSTICS);
        for (const code of Object.keys(DIAGNOSTICS)) expect(page).toContain(`\`${code}\``);
        expect(page).toContain('"{operator}" between {left} and {right} requires an explicit CAST');
    });

    test('changes when an explanation changes', () => {
        const changed = { ...DIAGNOSTICS, 'type.implicitCoercion': { ...DIAGNOSTICS['type.implicitCoercion'], doc: 'A different sentence.' } };
        expect(renderDiagnosticsDoc(changed)).not.toBe(renderDiagnosticsDoc(DIAGNOSTICS));
    });
});

describe('minab check --json', () => {
    test('prints the code and the parameters of a type error', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'minab-codes-'));
        writeFileSync(join(dir, 'rule.minab'), `let a: TEXT = "x";\nlet b: INTEGER = 1;\na == b\n`);
        const stdout: string[] = [];
        const stderr: string[] = [];
        const io: CliIo = { cwd: dir, out: text => stdout.push(text), err: text => stderr.push(text) };
        const code = await runCli(['check', join(dir, 'rule.minab'), '--json'], io);
        expect(code).toBe(EXIT_PROGRAM_ERROR);
        const printed = JSON.parse(stdout.join('\n'));
        expect(printed.ok).toBe(false);
        expect(printed.diagnostics[0].code).toBe('type.implicitCoercion');
        expect(printed.diagnostics[0].data.params).toEqual({ operator: '==', left: 'TEXT', right: 'INTEGER' });
        // The human-readable text on stderr is the same as before.
        expect(stderr.join('\n')).toContain('"==" between TEXT and INTEGER requires an explicit CAST (no implicit coercion)');
    });
});
