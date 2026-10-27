import { EmptyFileSystem } from 'langium';
import { describe, expect, test } from 'vitest';
import { complete, hover } from '../../src/editor/index.js';
import { createMinabServices } from '../../src/language/minab-module.js';
import { scalarType, type MinabSchema } from '../../src/language/schema.js';
import { cursor, diagnose, open } from './support.js';

/** Shamsine card M.1b: the editor on keys of a `JSON` value (spec §7.3.1). */

const scalar = (base: Parameters<typeof scalarType>[0], nullable = false) => ({ kind: 'scalar' as const, type: scalarType(base, { nullable }) });

const schema: MinabSchema = {
    version: 'editor-json-keys',
    tables: [
        {
            name: 'Place',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('INTEGER') },
                { name: 'title', type: scalar('TEXT') },
                { name: 'location', type: scalar('JSON', true) },
                { name: 'tags', type: scalar('JSON', true) }
            ]
        }
    ]
};

const services = createMinabServices(EmptyFileSystem, schema, { isFieldRule: false, recordTable: 'Place' }, { mode: 'production' }).Minab;

const errors = async (source: string) => (await diagnose(services, source)).filter(d => d.severity === 1).map(d => String(d.code));

describe('editor help on keys of a JSON value', () => {
    test('no marker for a key, a text key, a position or a count', async () => {
        for (const source of ['CAST(.location.lat AS DECIMAL) > 35.7', 'CAST(.location["lat"] AS DECIMAL) > 35.7', '.tags[0].id is null', 'COUNT(.tags) > 0']) {
            expect(await errors(source), source).toEqual([]);
        }
    });

    test('a key on a value that is not JSON still has its marker', async () => {
        expect(await errors('.title.x is null')).toEqual(['type.memberOnNonRecord']);
    });

    test('hover on a key says it is a key and shows the JSON type', () => {
        const { source, offset } = cursor('CAST(.location.la|t AS DECIMAL) > 35.7');
        const contents = hover(open(services, source), offset)?.contents;
        expect(contents).toContain('key of a JSON value');
        expect(contents).toContain('**type** `JSON?`');
    });

    test('completion after a key offers no columns and does not fail', async () => {
        const { source, offset } = cursor('.location.|');
        const result = await complete(open(services, source), offset);
        expect(result.items.filter(i => i.kind === 'column')).toEqual([]);
    });
});
