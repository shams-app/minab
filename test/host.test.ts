import { describe, expect, test } from 'vitest';
import { ConfigError, parseConfig, parseJsonObject } from '../src/host/config.js';
import { FixtureExecutor } from '../src/host/fixture-executor.js';
import { formatSql } from '../src/host/format.js';

/**
 * `src/host/` is the file-system-free half of the CLI's host: what the web
 * playground imports. The CLI suite covers it through `loadConfigFile`;
 * these cases cover what only a host *without* files sees.
 */

describe('parseConfig without a file system', () => {
    test('expands an inline config the same way the CLI does', () => {
        const config = parseConfig({
            schema: { tables: [{ name: 'Order', primaryKey: 'id', columns: { id: 'UUID', total: 'DECIMAL?' } }] },
            rule: { recordTable: 'Order', fieldType: 'DECIMAL' },
            record: { id: 'o-1', total: 5 },
            data: [{ match: 'EXISTS', value: true }]
        });
        expect(config.schema.tables[0].columns[1]).toMatchObject({
            name: 'total',
            type: { kind: 'scalar', type: { base: 'DECIMAL', nullable: true } }
        });
        expect(config.ruleContext).toMatchObject({ isFieldRule: true, recordTable: 'Order' });
        expect(config.responses).toEqual([{ match: 'EXISTS', rows: [{ value: true }] }]);
    });

    test('rejects a path, since there is nothing to read it from', () => {
        expect(() => parseConfig({ record: 'booking.json' })).toThrow(ConfigError);
        expect(() => parseConfig({ record: 'booking.json' })).toThrow(/names a file.*write the value inline/);
    });

    test('names the JSON path of a bad column type', () => {
        expect(() => parseConfig({ schema: { tables: [{ name: 'T', columns: { x: 'NUMBER' } }] } }))
            .toThrow('schema.tables[0].columns.x: unknown type "NUMBER"');
    });

    test('parseJsonObject reports where invalid JSON came from', () => {
        expect(() => parseJsonObject('{', 'editor')).toThrow(/^editor: invalid JSON/);
        expect(() => parseJsonObject('[]', 'editor')).toThrow('editor: expected a JSON object at the top level');
    });
});

describe('the fixture executor and formatting', () => {
    test('answers the first matching response and records the statement', async () => {
        const executor = new FixtureExecutor([{ match: 'EXISTS', rows: [{ value: false }] }]);
        const query = { text: 'SELECT EXISTS (SELECT 1) AS "value"', params: [] };
        expect(await executor.execute(query)).toEqual([{ value: false }]);
        expect(executor.statements).toEqual([query]);
    });

    test('formatSql lists parameters as SQL comments', () => {
        expect(formatSql({ text: 'SELECT $1', params: ['a'] })).toBe('SELECT $1\n-- parameters\n--   $1 = "a"');
    });
});
