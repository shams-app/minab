import { describe, expect, test } from 'vitest';
import { parseConfig } from '../src/host/config.js';
import { createMinab } from '../src/runtime/index.js';

/**
 * Shamsine card M.1b: keys of a `JSON` value (spec §7.3.1). The answers in both runtimes are in
 * `test/differential/cases/m1b-json-keys.cases.ts`; this file has the checks, the analysis and the host inputs.
 */

const { schema } = parseConfig({
    schema: {
        tables: [
            {
                name: 'Rec',
                primaryKey: 'id',
                columns: { id: 'INTEGER', label: 'TEXT', location: 'JSON?', attachment: 'JSON?', tags: 'JSON?', total: 'DECIMAL' }
            }
        ]
    }
});

const minab = createMinab({
    schema,
    ruleContext: { recordTable: 'Rec', isFieldRule: false },
    inputs: { url: 'JSON', user: { id: 'TEXT' } }
});

const codes = async (source: string): Promise<string[]> => (await minab.prepare(source)).diagnostics.filter(d => d.severity === 'error').map(d => d.code);

describe('the check', () => {
    test('a key of a JSON value is JSON', async () => {
        for (const source of ['.location.lat', '.location.a.b.c', '.attachment["name"]', '.tags[0]', '.tags[0].id', 'url.tab', 'url["tab"]']) {
            const program = await minab.prepare(source);
            expect(
                program.diagnostics.filter(d => d.severity === 'error'),
                source
            ).toEqual([]);
            expect(program.resultType, source).toBe('JSON?');
        }
    });

    test('a key needs a cast before it is compared (no implicit conversion)', async () => {
        // A JSON value is not orderable and does not mix with a number.
        expect(await codes('.location.lat > 35')).toEqual(['type.orderingNeedsOrderable']);
        expect(await codes('.location.lat == 35')).toContain('type.implicitCoercion');
        expect(await codes('CAST(.location.lat AS DECIMAL) > 35')).toEqual([]);
        expect(await codes('.location.lat is number')).toEqual([]);
    });

    test('a key of a value that is not JSON is still an error', async () => {
        expect(await codes('.label.x')).toEqual(['type.memberOnNonRecord']);
        expect(await codes('.total.x')).toEqual(['type.memberOnNonRecord']);
        expect(await codes('.label["x"]')).toEqual(['type.invalidFilter']);
    });

    test('a key that is not a text, a whole number or a condition is still an error', async () => {
        expect(await codes('.location[1.5 + 1]')).toEqual(['type.invalidFilter']);
        expect(await codes('.location[url]')).toEqual(['type.invalidFilter']);
    });

    test('inside [ ] a bare "." is the element, so a key is not read from the record', async () => {
        expect(await codes('.location[.label]')).toEqual(['type.columnNeedsTable']);
    });

    test('COUNT of a JSON value is an integer; a number is no collection', async () => {
        expect((await minab.prepare('COUNT(.tags)')).resultType).toBe('INTEGER');
        expect(await codes('COUNT(.total)')).not.toEqual([]);
    });

    test('a cast of a key to a scalar checks', async () => {
        for (const target of ['TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN']) {
            expect(await codes(`CAST(.location.x AS ${target})`), target).toEqual([]);
        }
    });
});

describe('the analysis: a key of a JSON value needs no data', () => {
    test('a key of a record field is local and depends on the field', async () => {
        const program = await minab.prepare('CAST(.location.lat AS DECIMAL) > 35.7');
        expect(program.analysis.tier).toBe('local');
        expect(program.analysis.recordFields).toEqual(['location']);
        expect(program.dependsOn('location')).toBe(true);
        expect(program.dependsOn('label')).toBe(false);
    });

    test('a count of a JSON array and a kind test are local', async () => {
        for (const source of ['COUNT(.tags) > 0', '.tags is array', '.tags[0].id isnot null', 'CAST(.attachment["name"] AS TEXT) == "x"']) {
            expect((await minab.prepare(source)).analysis.tier, source).toBe('local');
        }
    });

    test('a key of a host input reads the input only', async () => {
        const program = await minab.prepare('CAST(url.tab AS TEXT) == "details"');
        expect(program.analysis.tier).toBe('local');
        expect(program.analysis.inputs).toEqual(['url']);
    });
});

describe('local runs', () => {
    const rec = {
        label: 'name',
        location: { lat: 35.75, lng: 51.41 },
        attachment: { name: 'plan.pdf', size: 120000 },
        tags: [{ id: 'a' }, { id: 'b' }]
    };
    const run = async (source: string, record: Record<string, unknown> = rec, hostInputs: Record<string, unknown> = {}) =>
        await (await minab.prepare(source)).run({ record, hostInputs });

    test('the card examples', async () => {
        expect(await run('CAST(.location.lat AS DECIMAL) > 35.7')).toMatchObject({ ok: true, value: true });
        expect(await run('CAST(.attachment.size AS INTEGER) < 5000000')).toMatchObject({ ok: true, value: true });
        expect(await run('CAST(.attachment["name"] AS TEXT)')).toMatchObject({ ok: true, value: 'plan.pdf' });
        expect(await run('COUNT(.tags)')).toMatchObject({ ok: true, value: 2 });
    });

    test('a host input of type JSON has keys (url.tab)', async () => {
        expect(await run('CAST(url.tab AS TEXT) == "details"', rec, { url: { tab: 'details' } })).toMatchObject({ ok: true, value: true });
        expect(await run('url.tab is null', rec, { url: {} })).toMatchObject({ ok: true, value: true });
        expect(await run('url.tab is null', rec, { url: 'not an object' })).toMatchObject({ ok: true, value: true });
    });

    test('a key can be a let name, a host input or an expression of them', async () => {
        expect(await run('let key: TEXT = "name";\nCAST(.attachment[key] AS TEXT)')).toMatchObject({ ok: true, value: 'plan.pdf' });
        expect(await run('let key: TEXT = "nothing";\n.attachment[key] is null')).toMatchObject({ ok: true, value: true });
        expect(await run('CAST(.attachment[CAST(url.field AS TEXT)] AS TEXT)', rec, { url: { field: 'name' } })).toMatchObject({ ok: true, value: 'plan.pdf' });
        // A key of a host input is `JSON`: it needs a cast to be a key. A missing input key is `null`, and a `null` key is no key.
        expect(await run('.attachment[CAST(url.field AS TEXT)] is null', rec, { url: {} })).toMatchObject({ ok: true, value: true });
        expect(await run('CAST(.attachment["na" + "me"] AS TEXT)')).toMatchObject({ ok: true, value: 'plan.pdf' });
    });

    test('a key the object only inherits is a missing key', async () => {
        for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            expect(await run(`.attachment["${key}"] is null`), key).toMatchObject({ ok: true, value: true });
        }
    });

    test('a wrong kind in a cast is eval.castFailed', async () => {
        expect(await run('CAST(.attachment.name AS INTEGER)')).toMatchObject({ ok: false, error: { code: 'eval.castFailed' } });
        expect(await run('CAST(.attachment.size AS TEXT)')).toMatchObject({ ok: false, error: { code: 'eval.castFailed' } });
        expect(await run('CAST(.location AS TEXT)')).toMatchObject({ ok: false, error: { code: 'eval.castFailed' } });
    });

    test('a column that is null gives null for every key', async () => {
        const empty = { label: 'x', location: null, attachment: null, tags: null };
        expect(await run('.location.lat is null', empty)).toMatchObject({ ok: true, value: true });
        expect(await run('.attachment["name"] is null', empty)).toMatchObject({ ok: true, value: true });
        expect(await run('.tags[0].id is null', empty)).toMatchObject({ ok: true, value: true });
        expect(await run('COUNT(.tags)', empty)).toMatchObject({ ok: true, value: 0 });
    });
});

describe('a grouped query keeps the count of the group', () => {
    test('COUNT(.tags) after GROUPBY counts rows, not array elements', async () => {
        const program = await minab.prepare('FROM Rec GROUPBY .label SELECT .label, COUNT(.tags) AS n');
        expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    });
});
