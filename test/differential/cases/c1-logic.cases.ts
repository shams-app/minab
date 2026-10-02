import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

const record = { id: 1, a: 5, yes: true, no: false };

export const cases: DifferentialCase[] = [
    { name: 'AND, both true', schema, record, expr: '.yes AND .yes', expect: true },
    { name: 'AND, one false', schema, record, expr: '.yes AND .no', expect: false },
    { name: 'OR, one true', schema, record, expr: '.no OR .yes', expect: true },
    { name: 'OR, both false', schema, record, expr: '.no OR .no', expect: false },
    { name: 'NOT true', schema, record, expr: 'NOT .yes', expect: false },
    { name: 'NOT false', schema, record, expr: 'NOT .no', expect: true },
    { name: 'NOT binds tighter than AND', schema, record, expr: 'NOT .no AND .yes', expect: true },
    { name: 'AND binds tighter than OR', schema, record, expr: '.yes OR .no AND .no', expect: true },
    { name: 'IN finds a member', schema, record, expr: '.a IN [1, 5, 9]', expect: true },
    { name: 'IN misses a non-member', schema, record, expr: '.a IN [1, 2, 3]', expect: false },
    { name: 'boolean equality', schema, record, expr: '.yes == .yes', expect: true }
];
