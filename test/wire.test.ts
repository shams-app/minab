/**
 * Production plan phase R6 — wire format v1 (`src/runtime/wire.ts`, decisions D34, D17, D21, D36).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Big } from '../src/language/values.js';
import {
    DEFAULT_LIMITS,
    WireError,
    decodeValue,
    encodeValue,
    parseRequest,
    parseResponse,
    wireErrorResponse,
    wireScalar,
    type Json,
    type WireRequest,
    type WireResponse,
    type WireRun,
    type WireType
} from '../src/runtime/index.js';
import { isDiagnosticCode } from '../src/language/diagnostics/codes.js';

const requestSchema = JSON.parse(readFileSync(new URL('../schemas/wire-v1.request.json', import.meta.url), 'utf8'));
const responseSchema = JSON.parse(readFileSync(new URL('../schemas/wire-v1.response.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// A small JSON Schema checker. It knows only what our two schema files use, so
// the test needs no new dependency (D09).
// ---------------------------------------------------------------------------

type Schema = Record<string, any>;

function typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function check(schema: Schema, value: unknown, root: Schema): boolean {
    if (schema.$ref) {
        const name = String(schema.$ref).replace('#/$defs/', '');
        return check(root.$defs[name], value, root);
    }
    if (schema.const !== undefined && value !== schema.const) return false;
    if (schema.type !== undefined) {
        const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.includes(typeOf(value))) return false;
    }
    if (schema.oneOf) {
        const matching = schema.oneOf.filter((option: Schema) => check(option, value, root));
        if (matching.length !== 1) return false;
    }
    if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) return false;
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) return false;
        if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
        if (schema.items && !value.every(item => check(schema.items, item, root))) return false;
    }
    if (typeOf(value) === 'object') {
        const obj = value as Record<string, unknown>;
        for (const key of schema.required ?? []) if (!(key in obj)) return false;
        for (const [key, item] of Object.entries(obj)) {
            const own = schema.properties?.[key];
            if (own) {
                if (!check(own, item, root)) return false;
            } else if (schema.additionalProperties === false) {
                return false;
            } else if (typeof schema.additionalProperties === 'object' && !check(schema.additionalProperties, item, root)) {
                return false;
            }
        }
    }
    return true;
}

const matchesRequestSchema = (value: unknown) => check(requestSchema, value, requestSchema);
const matchesResponseSchema = (value: unknown) => check(responseSchema, value, responseSchema);

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const S = (base: Parameters<typeof wireScalar>[0], array = false) => wireScalar(base, { array });

const CASES: { name: string; type: WireType; value: unknown; json: Json }[] = [
    { name: 'TEXT', type: S('TEXT'), value: 'سلام', json: 'سلام' },
    { name: 'CITEXT', type: S('CITEXT'), value: 'A@B.c', json: 'A@B.c' },
    { name: 'UUID', type: S('UUID'), value: '6f0c9d8e-0000-4000-8000-000000000001', json: '6f0c9d8e-0000-4000-8000-000000000001' },
    { name: 'INTEGER', type: S('INTEGER'), value: 9007199254740991, json: 9007199254740991 },
    { name: 'negative INTEGER', type: S('INTEGER'), value: -42, json: -42 },
    { name: 'DECIMAL', type: S('DECIMAL'), value: new Big('24.9'), json: '24.9' },
    { name: 'DECIMAL with many digits', type: S('DECIMAL'), value: new Big('12345678901234567890.123456789'), json: '12345678901234567890.123456789' },
    { name: 'negative DECIMAL', type: S('DECIMAL'), value: new Big('-0.001'), json: '-0.001' },
    { name: 'BOOLEAN true', type: S('BOOLEAN'), value: true, json: true },
    { name: 'BOOLEAN false', type: S('BOOLEAN'), value: false, json: false },
    { name: 'DATE', type: S('DATE'), value: '2026-10-02', json: '2026-10-02' },
    { name: 'leap day', type: S('DATE'), value: '2024-02-29', json: '2024-02-29' },
    { name: 'TIME', type: S('TIME'), value: '08:30:00', json: '08:30:00' },
    { name: 'TIME with fraction', type: S('TIME'), value: '23:59:59.123', json: '23:59:59.123' },
    { name: 'DATETIME', type: S('DATETIME'), value: new Date('2026-10-02T08:30:00.000Z'), json: '2026-10-02T08:30:00.000Z' },
    { name: 'JSON object', type: S('JSON'), value: { a: [1, 2.5, null], b: { c: 'x' } }, json: { a: [1, 2.5, null], b: { c: 'x' } } },
    { name: 'JSON number', type: S('JSON'), value: 1.5, json: 1.5 },
    { name: 'null', type: S('TEXT'), value: null, json: null },
    { name: 'null DECIMAL', type: S('DECIMAL'), value: null, json: null },
    { name: 'array of DECIMAL', type: S('DECIMAL', true), value: [new Big('0.1'), null, new Big('3')], json: ['0.1', null, '3'] },
    { name: 'array of DATETIME', type: S('DATETIME', true), value: [new Date('2026-01-01T00:00:00.000Z')], json: ['2026-01-01T00:00:00.000Z'] },
    {
        name: 'record',
        type: { kind: 'record', fields: { id: S('UUID'), total: S('DECIMAL'), due: S('DATE'), tags: S('TEXT', true) } },
        value: { id: 'u1', total: new Big('24.9'), due: '2026-10-02', tags: ['a', 'b'] },
        json: { id: 'u1', total: '24.9', due: '2026-10-02', tags: ['a', 'b'] }
    },
    {
        name: 'list of records',
        type: { kind: 'list', item: { kind: 'record', fields: { n: S('INTEGER'), price: S('DECIMAL') } } },
        value: [
            { n: 1, price: new Big('0.5') },
            { n: 2, price: null }
        ],
        json: [
            { n: 1, price: '0.5' },
            { n: 2, price: null }
        ]
    },
    { name: 'empty list', type: { kind: 'list', item: S('INTEGER') }, value: [], json: [] }
];

describe('value encoding', () => {
    test.each(CASES)('$name encodes to its JSON', ({ type, value, json }) => {
        expect(encodeValue(value, type)).toEqual(json);
    });

    test.each(CASES)('$name round-trips exactly, also through JSON text', ({ type, value, json }) => {
        const text = JSON.stringify(encodeValue(value, type));
        expect(JSON.parse(text)).toEqual(json);
        const back = decodeValue(JSON.parse(text), type);
        if (value instanceof Big) expect((back as Big).eq(value)).toBe(true);
        else expect(back).toEqual(value);
        // and encoding the decoded value again gives the same JSON
        expect(encodeValue(back, type)).toEqual(json);
    });

    test('a decimal survives JSON.stringify and JSON.parse exactly, a number would not', () => {
        const sum = new Big('0.1').plus('0.2');
        expect(JSON.parse(JSON.stringify({ v: encodeValue(sum, S('DECIMAL')) })).v).toBe('0.3');
        const long = '9007199254740993.000000000000001';
        const wire = JSON.parse(JSON.stringify(encodeValue(new Big(long), S('DECIMAL'))));
        expect(wire).toBe(long);
        expect((decodeValue(wire, S('DECIMAL')) as Big).eq(new Big(long))).toBe(true);
        expect(String(Number(long))).not.toBe(long);
    });

    test('DECIMAL is a string, never a JSON number: a number is refused on input', () => {
        expect(() => decodeValue(24.9, S('DECIMAL'))).toThrow(WireError);
    });

    test('encoding a decimal text or a JS number gives the shortest exact form', () => {
        expect(encodeValue('24.90', S('DECIMAL'))).toBe('24.9');
        expect(encodeValue(0.5, S('DECIMAL'))).toBe('0.5');
        expect(encodeValue(new Big('-0'), S('DECIMAL'))).toBe('0');
    });

    test('a DATETIME is always UTC with Z; a Date or UTC text is accepted on encode', () => {
        expect(encodeValue(new Date(Date.UTC(2026, 9, 2, 8, 30)), S('DATETIME'))).toBe('2026-10-02T08:30:00.000Z');
        expect(encodeValue('2026-10-02T08:30:00Z', S('DATETIME'))).toBe('2026-10-02T08:30:00.000Z');
        expect(decodeValue('2026-10-02T08:30:00Z', S('DATETIME'))).toEqual(new Date('2026-10-02T08:30:00.000Z'));
    });

    test.each([
        ['an offset instead of Z', '2026-10-02T08:30:00+03:30', 'DATETIME'],
        ['no time zone', '2026-10-02T08:30:00', 'DATETIME'],
        ['an impossible date', '2026-02-30', 'DATE'],
        ['a date with a time', '2026-10-02T00:00:00Z', 'DATE'],
        ['an impossible time', '25:00:00', 'TIME'],
        ['a decimal with an exponent', '1e3', 'DECIMAL'],
        ['a decimal that is text with spaces', ' 1.5', 'DECIMAL'],
        ['an INTEGER as text', '24', 'INTEGER'],
        ['a fraction as INTEGER', 1.5, 'INTEGER'],
        ['an INTEGER outside the safe range', 9007199254740992, 'INTEGER'],
        ['a number as TEXT', 5, 'TEXT'],
        ['text as BOOLEAN', 'true', 'BOOLEAN']
    ] as const)('decode refuses %s', (_name, json, base) => {
        expect(() => decodeValue(json, S(base))).toThrow(WireError);
    });

    test.each([
        ['an INTEGER outside the safe range', 2 ** 60, 'INTEGER'],
        ['a fraction as INTEGER', 1.5, 'INTEGER'],
        ['a bad decimal text', 'abc', 'DECIMAL'],
        ['NaN as DECIMAL', Number.NaN, 'DECIMAL'],
        ['an invalid Date', new Date('nope'), 'DATETIME'],
        ['a Date inside JSON', { at: new Date() }, 'JSON'],
        ['Infinity inside JSON', [Infinity], 'JSON'],
        ['a number as TEXT', 5, 'TEXT']
    ] as const)('encode refuses %s', (_name, value, base) => {
        expect(() => encodeValue(value, S(base))).toThrow(WireError);
    });

    test('an error has the code wire.invalidValue, the path and the type, and never the value', () => {
        const type: WireType = { kind: 'list', item: { kind: 'record', fields: { price: S('DECIMAL') } } };
        try {
            decodeValue([{ price: '1.5' }, { price: 'secret-value' }], type);
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(WireError);
            const wire = (error as WireError).error;
            expect(wire.code).toBe('wire.invalidValue');
            expect(wire.params).toEqual({ path: '[1].price', expected: 'DECIMAL' });
            expect(JSON.stringify(wire)).not.toContain('secret-value');
        }
    });

    test('a record refuses a field its type does not name, both ways', () => {
        const type: WireType = { kind: 'record', fields: { a: S('INTEGER') } };
        expect(() => decodeValue({ a: 1, b: 2 }, type)).toThrow(WireError);
        expect(() => encodeValue({ a: 1, b: 2 }, type)).toThrow(WireError);
        expect(decodeValue({}, type)).toEqual({});
    });

    test('an array type needs an array', () => {
        expect(() => decodeValue('x', S('TEXT', true))).toThrow(WireError);
        expect(() => encodeValue('x', S('TEXT', true))).toThrow(WireError);
    });

    test('a field called __proto__ or constructor is not a field', () => {
        const type: WireType = { kind: 'record', fields: { a: S('INTEGER') } };
        expect(() => decodeValue(JSON.parse('{"__proto__": 1}'), type)).toThrow(WireError);
        expect(() => decodeValue({ constructor: 1 }, type)).toThrow(WireError);
    });
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const ref = { ref: { id: 'view_1:el_2:props.visible', version: '17' } };
const goodRun: WireRun = { id: 'r1', program: ref };
const oneRun = (run: unknown = goodRun, v: unknown = 1) => ({ v, runs: [run] });

function failed(result: ReturnType<typeof parseRequest> | ReturnType<typeof parseResponse>) {
    if (result.ok) throw new Error('expected an error');
    return result.error;
}

describe('parseRequest', () => {
    test('accepts a minimal request and returns it', () => {
        const parsed = parseRequest(oneRun());
        expect(parsed).toEqual({ ok: true, value: { v: 1, runs: [goodRun] } });
    });

    test('accepts every field', () => {
        const request: WireRequest = {
            v: 1,
            runs: [
                {
                    id: 'r1',
                    program: ref,
                    inputs: { url: { tab: 'open' } },
                    record: { id: 'o-1', total: '24.90', due: '2026-10-02' },
                    fieldValue: null,
                    options: { limits: { wallTimeMs: 500 }, logs: true }
                },
                { id: 'r2', program: { source: '1 + 1' } }
            ]
        };
        expect(parseRequest(request, { allowSource: true })).toEqual({ ok: true, value: request });
    });

    test('rejects an unknown version with wire.unsupportedVersion, and lists the known ones', () => {
        const error = failed(parseRequest(oneRun(goodRun, 2)));
        expect(error.code).toBe('wire.unsupportedVersion');
        expect(error.params).toEqual({ version: '2', supported: '1' });
        expect(failed(parseRequest(oneRun(goodRun, '1'))).code).toBe('wire.unsupportedVersion');
        expect(failed(parseRequest(oneRun(goodRun, null))).code).toBe('wire.unsupportedVersion');
    });

    test('rejects a missing version with wire.invalidRequest', () => {
        const error = failed(parseRequest({ runs: [goodRun] }));
        expect(error.code).toBe('wire.invalidRequest');
        expect(error.params.path).toBe('v');
    });

    test('rejects a run with no id, an empty id or an id that is not text', () => {
        for (const id of [undefined, '', 5, null]) {
            const error = failed(parseRequest(oneRun({ id, program: ref })));
            expect(error.code).toBe('wire.invalidRequest');
            expect(error.params.path).toBe('runs[0].id');
        }
    });

    test('rejects the same id twice', () => {
        const error = failed(parseRequest({ v: 1, runs: [goodRun, { ...goodRun }] }));
        expect(error.code).toBe('wire.invalidRequest');
        expect(error.params.path).toBe('runs[1].id');
    });

    test('accepts 100 runs and rejects 101 with wire.tooManyRuns (D36)', () => {
        const runs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, program: ref }));
        expect(parseRequest({ v: 1, runs: runs(100) }).ok).toBe(true);
        const error = failed(parseRequest({ v: 1, runs: runs(101) }));
        expect(error.code).toBe('wire.tooManyRuns');
        expect(error.params).toEqual({ limit: 100, used: 101 });
        expect(DEFAULT_LIMITS.batchRuns).toBe(100);
    });

    test('a host can lower or raise the number of runs', () => {
        const runs = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, program: ref }));
        expect(failed(parseRequest({ v: 1, runs }, { maxRuns: 2 })).code).toBe('wire.tooManyRuns');
        expect(parseRequest({ v: 1, runs }, { maxRuns: 3 }).ok).toBe(true);
    });

    test('refuses source text unless the server is in development mode (D34)', () => {
        const source = oneRun({ id: 'r1', program: { source: 'DELETE FROM x' } });
        const error = failed(parseRequest(source));
        expect(error.code).toBe('wire.invalidRequest');
        expect(error.params.path).toBe('runs[0].program.source');
        expect(parseRequest(source, { allowSource: true }).ok).toBe(true);
    });

    test.each([
        ['not an object', 'x', '(root)'],
        ['an array', [], '(root)'],
        ['no runs', { v: 1 }, 'runs'],
        ['runs is not a list', { v: 1, runs: {} }, 'runs'],
        ['an empty list of runs', { v: 1, runs: [] }, 'runs'],
        ['a run that is not an object', oneRun('x'), 'runs[0]'],
        ['no program', oneRun({ id: 'r1' }), 'runs[0].program'],
        ['a program with neither ref nor source', oneRun({ id: 'r1', program: {} }), 'runs[0].program'],
        ['a ref with no version', oneRun({ id: 'r1', program: { ref: { id: 'p' } } }), 'runs[0].program.ref.version'],
        ['a ref with a number as id', oneRun({ id: 'r1', program: { ref: { id: 5, version: '1' } } }), 'runs[0].program.ref.id'],
        ['inputs that is a list', oneRun({ ...goodRun, inputs: [] }), 'runs[0].inputs'],
        ['record that is text', oneRun({ ...goodRun, record: 'x' }), 'runs[0].record'],
        ['options that is a list', oneRun({ ...goodRun, options: [] }), 'runs[0].options'],
        ['logs that is text', oneRun({ ...goodRun, options: { logs: 'yes' } }), 'runs[0].options.logs'],
        ['an unknown limit', oneRun({ ...goodRun, options: { limits: { bogus: 1 } } }), 'runs[0].options.limits.bogus'],
        ['a limit of zero', oneRun({ ...goodRun, options: { limits: { wallTimeMs: 0 } } }), 'runs[0].options.limits.wallTimeMs'],
        ['a limit that is text', oneRun({ ...goodRun, options: { limits: { statements: '5' } } }), 'runs[0].options.limits.statements']
    ])('rejects %s with wire.invalidRequest and its path', (_name, json, path) => {
        const error = failed(parseRequest(json));
        expect(error.code).toBe('wire.invalidRequest');
        expect(error.params.path).toBe(path);
    });

    test('ignores fields it does not know, so a later v1 can add optional ones', () => {
        const parsed = parseRequest({ v: 1, future: true, runs: [{ ...goodRun, extra: 1 }] });
        expect(parsed).toEqual({ ok: true, value: { v: 1, runs: [goodRun] } });
    });

    test('an error never holds the value that was wrong', () => {
        const error = failed(parseRequest(oneRun({ id: 'r1', program: ref, inputs: 'top-secret-token' })));
        expect(JSON.stringify(error)).not.toContain('top-secret-token');
    });

    test('works on what JSON.parse gives, also with a null prototype', () => {
        const parsed = parseRequest(JSON.parse(JSON.stringify(oneRun())));
        expect(parsed.ok).toBe(true);
        expect(parseRequest(Object.assign(Object.create(null), oneRun())).ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const stats = { statements: 1, rows: 1, durationMs: 3 };
const goodResponse: WireResponse = {
    v: 1,
    results: [
        { id: 'r1', ok: true, value: '24.9', logs: [], stats },
        {
            id: 'r2',
            ok: false,
            error: {
                code: 'limit.tooManyStatements',
                message: 'too many',
                range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
                params: { limit: 100 }
            },
            stats
        }
    ]
};

describe('parseResponse', () => {
    test('accepts a response with a value and an error', () => {
        expect(parseResponse(goodResponse)).toEqual({ ok: true, value: goodResponse });
    });

    test('a value may be any JSON, also null', () => {
        const response = { v: 1, results: [{ id: 'a', ok: true, value: null, stats }] };
        expect(parseResponse(response).ok).toBe(true);
    });

    test('accepts the error body of a request that failed as a whole', () => {
        const error = failed(parseRequest(oneRun(goodRun, 9)));
        const body = wireErrorResponse(error);
        expect(parseResponse(JSON.parse(JSON.stringify(body)))).toEqual({ ok: true, value: body });
        expect(body).toEqual({ v: 1, error: { code: 'wire.unsupportedVersion', message: expect.any(String), params: { version: '9', supported: '1' } } });
    });

    test('accepts a null range (the ADR example)', () => {
        const response = { v: 1, results: [{ id: 'a', ok: false, error: { code: 'eval.failed', message: 'm', range: null, params: {} }, stats }] };
        expect(parseResponse(response).ok).toBe(true);
    });

    test('ignores unknown fields, so an older client reads a newer server', () => {
        const response = { v: 1, future: 1, results: [{ id: 'a', ok: true, value: 1, stats: { ...stats, loopIterations: 0 }, droppedLogs: 0 }] };
        const parsed = parseResponse(response);
        expect(parsed.ok).toBe(true);
    });

    test('rejects an unknown version with wire.unsupportedVersion', () => {
        expect(failed(parseResponse({ v: 2, results: [] })).code).toBe('wire.unsupportedVersion');
    });

    test.each([
        ['not an object', 5, '(root)'],
        ['no version', { results: [] }, 'v'],
        ['no results', { v: 1 }, 'results'],
        ['a result with no id', { v: 1, results: [{ ok: true, value: 1, stats }] }, 'results[0].id'],
        ['a result with no ok', { v: 1, results: [{ id: 'a', value: 1, stats }] }, 'results[0].ok'],
        ['an ok result with no value', { v: 1, results: [{ id: 'a', ok: true, stats }] }, 'results[0].value'],
        ['an ok result with no stats', { v: 1, results: [{ id: 'a', ok: true, value: 1 }] }, 'results[0].stats'],
        ['stats with a text number', { v: 1, results: [{ id: 'a', ok: true, value: 1, stats: { ...stats, rows: '1' } }] }, 'results[0].stats.rows'],
        ['a failed result with no error', { v: 1, results: [{ id: 'a', ok: false }] }, 'results[0].error'],
        ['an error with no code', { v: 1, results: [{ id: 'a', ok: false, error: { message: 'm', params: {} } }] }, 'results[0].error.code'],
        ['an error with no params', { v: 1, results: [{ id: 'a', ok: false, error: { code: 'x', message: 'm' } }] }, 'results[0].error.params'],
        [
            'a param that is a list',
            { v: 1, results: [{ id: 'a', ok: false, error: { code: 'x', message: 'm', params: { p: [] } } }] },
            'results[0].error.params.p'
        ],
        ['logs that are not text', { v: 1, results: [{ id: 'a', ok: true, value: 1, logs: [1], stats }] }, 'results[0].logs[0]']
    ])('rejects %s with wire.invalidResponse and its path', (_name, json, path) => {
        const error = failed(parseResponse(json));
        expect(error.code).toBe('wire.invalidResponse');
        expect(error.params.path).toBe(path);
    });
});

// ---------------------------------------------------------------------------
// The JSON Schema files
// ---------------------------------------------------------------------------

describe('JSON Schema files', () => {
    const full: WireRun = {
        id: 'r1',
        program: { ref: { id: 'p', version: '1' } },
        inputs: {},
        record: {},
        fieldValue: 1,
        options: { limits: { ...DEFAULT_LIMITS }, logs: false }
    };

    test('the request schema names the fields of the TypeScript types', () => {
        expect(Object.keys(requestSchema.properties).sort()).toEqual(['runs', 'v']);
        expect(Object.keys(requestSchema.$defs.run.properties).sort()).toEqual(Object.keys(full).sort());
        expect(Object.keys(requestSchema.$defs.run.properties.options.properties).sort()).toEqual(Object.keys(full.options!).sort());
        expect(Object.keys(requestSchema.$defs.run.properties.options.properties.limits.properties).sort()).toEqual(Object.keys(DEFAULT_LIMITS).sort());
        expect(requestSchema.$defs.run.properties.program.oneOf.map((o: Schema) => Object.keys(o.properties))).toEqual([['ref'], ['source']]);
    });

    test('the response schema names the fields of the TypeScript types', () => {
        const ok = responseSchema.$defs.result.oneOf[0];
        const failure = responseSchema.$defs.result.oneOf[1];
        expect(Object.keys(ok.properties).sort()).toEqual(['id', 'logs', 'ok', 'stats', 'value']);
        expect(Object.keys(failure.properties).sort()).toEqual(['error', 'id', 'logs', 'ok', 'stats']);
        expect(Object.keys(responseSchema.$defs.error.properties).sort()).toEqual(['code', 'message', 'params', 'range']);
        expect(Object.keys(responseSchema.$defs.stats.properties).sort()).toEqual(['durationMs', 'rows', 'statements']);
    });

    const requests: [string, unknown][] = [
        ['a minimal request', oneRun()],
        ['a full request', { v: 1, runs: [full, { id: 'r2', program: { source: '1' } }] }],
        ['a wrong version', oneRun(goodRun, 2)],
        ['no version', { runs: [goodRun] }],
        ['no runs', { v: 1, runs: [] }],
        ['a run with no id', oneRun({ program: ref })],
        ['a run with an empty id', oneRun({ id: '', program: ref })],
        ['a run with no program', oneRun({ id: 'a' })],
        ['a program with both ref and source', oneRun({ id: 'a', program: { ...ref, source: '1' } })],
        ['a ref with no version', oneRun({ id: 'a', program: { ref: { id: 'p' } } })],
        ['inputs as a list', oneRun({ ...goodRun, inputs: [] })],
        ['a record as text', oneRun({ ...goodRun, record: 'x' })],
        ['a bad limit', oneRun({ ...goodRun, options: { limits: { wallTimeMs: 0 } } })],
        ['an unknown limit', oneRun({ ...goodRun, options: { limits: { x: 1 } } })],
        ['logs as text', oneRun({ ...goodRun, options: { logs: 'x' } })],
        ['unknown fields', { v: 1, extra: 1, runs: [{ ...goodRun, extra: 1 }] }]
    ];

    test.each(requests)('the schema and parseRequest agree on %s', (_name, json) => {
        expect(matchesRequestSchema(json)).toBe(parseRequest(json, { allowSource: true }).ok);
    });

    const responses: [string, unknown][] = [
        ['the example response', goodResponse],
        ['an error body', { v: 1, error: { code: 'wire.unsupportedVersion', message: 'm', params: { version: '9' } } }],
        ['a null range', { v: 1, results: [{ id: 'a', ok: false, error: { code: 'x', message: 'm', range: null, params: {} } }] }],
        ['a null value', { v: 1, results: [{ id: 'a', ok: true, value: null, stats }] }],
        ['an unknown version', { v: 2, results: [] }],
        ['no results', { v: 1 }],
        ['a result with no id', { v: 1, results: [{ ok: true, value: 1, stats }] }],
        ['an ok result with no value', { v: 1, results: [{ id: 'a', ok: true, stats }] }],
        ['an ok result with no stats', { v: 1, results: [{ id: 'a', ok: true, value: 1 }] }],
        ['a failed result with no error', { v: 1, results: [{ id: 'a', ok: false }] }],
        ['an error with no params', { v: 1, results: [{ id: 'a', ok: false, error: { code: 'x', message: 'm' } }] }],
        ['a param that is a list', { v: 1, results: [{ id: 'a', ok: false, error: { code: 'x', message: 'm', params: { p: [] } } }] }],
        ['stats with a text number', { v: 1, results: [{ id: 'a', ok: true, value: 1, stats: { ...stats, rows: '1' } }] }],
        ['logs that are not text', { v: 1, results: [{ id: 'a', ok: true, value: 1, logs: [1], stats }] }],
        ['unknown fields', { v: 1, x: 1, results: [{ id: 'a', ok: true, value: 1, stats: { ...stats, extra: 1 }, extra: 1 }] }]
    ];

    test.each(responses)('the schema and parseResponse agree on %s', (_name, json) => {
        expect(matchesResponseSchema(json)).toBe(parseResponse(json).ok);
    });

    test('the checker itself rejects what it should (so the agreement above means something)', () => {
        expect(matchesRequestSchema(oneRun())).toBe(true);
        expect(matchesRequestSchema(oneRun(goodRun, 2))).toBe(false);
        expect(matchesResponseSchema(goodResponse)).toBe(true);
        expect(matchesResponseSchema({ v: 1, results: [{ id: 'a', ok: true }] })).toBe(false);
    });
});

describe('the registry', () => {
    test('every wire code is registered', () => {
        for (const code of ['wire.invalidRequest', 'wire.invalidResponse', 'wire.invalidValue', 'wire.tooManyRuns', 'wire.unsupportedVersion']) {
            expect(isDiagnosticCode(code)).toBe(true);
        }
    });
});
