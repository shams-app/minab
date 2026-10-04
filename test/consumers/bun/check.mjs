// A Bun script: import the package and `./node`, prepare and run rules.
import assert from 'node:assert/strict';
import { createMinab } from '@shamsine/minab';
import { queryFunctionDataPort, systemClock } from '@shamsine/minab/node';

const scalar = base => ({ kind: 'scalar', type: { kind: 'scalar', base, nullable: false, array: false, arrayNullable: false } });
const schema = {
    version: 'v1',
    tables: [
        {
            name: 'Order',
            primaryKey: 'id',
            columns: [
                { name: 'id', type: scalar('UUID') },
                { name: 'total', type: scalar('DECIMAL') }
            ]
        }
    ]
};
const minab = createMinab({ schema, ruleContext: { recordTable: 'Order', isFieldRule: false } });

const rule = await minab.prepare('.total > 10');
assert.equal(rule.ok, true);
const pure = await rule.run({ record: { total: 25 } }, { clock: systemClock('Asia/Tehran') });
assert.equal(pure.ok, true);
assert.equal(pure.value, true);

const calls = [];
const data = queryFunctionDataPort(async (text, params) => {
    calls.push({ text, params });
    return [{ value: true }];
});
const exists = await minab.prepare('EXISTS(#Order[.id == ^.id])');
const result = await exists.run({ record: { id: 'o-1' } }, { data });
assert.equal(result.ok, true);
assert.equal(result.value, true);
assert.match(calls[0].text, /\$1/);
console.log('bun ok');
