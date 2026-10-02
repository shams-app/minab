import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

const nulls = { id: 1, n: null, m: null, t: null, a: 4 };
const values = { id: 1, n: 2, m: null, t: 'x', a: 4 };

export const cases: DifferentialCase[] = [
    { name: 'null == null (a column)', schema, record: nulls, expr: '.n == null', expect: true },
    { name: 'null != null is false', schema, record: nulls, expr: '.n != null', expect: false },
    { name: 'a value == null is false', schema, record: values, expr: '.n == null', expect: false },
    { name: 'a value != null is true', schema, record: values, expr: '.n != null', expect: true },
    { name: 'two null columns are equal', schema, record: nulls, expr: '.n == .m', expect: true },
    { name: 'a null and a value differ', schema, record: values, expr: '.n == .m', expect: false },
    { name: 'a null and a value are !=', schema, record: values, expr: '.n != .m', expect: true },
    { name: 'IN a list with null still finds a value', schema, record: values, expr: '.n IN [2, null]', expect: true },
    { name: 'text null == null', schema, record: nulls, expr: '.t == null', expect: true }
];
