import type { DifferentialCase } from '../harness.js';

/**
 * P2: a group expression as a SQL fragment. Postgres runs the fragment once, in
 * `GROUP BY GROUPING SETS ((), (Region), (Region, Month))`. The interpreter runs the
 * same expression on the rows of each group. Both must agree on every group.
 */

const schema = {
    tables: [
        {
            name: 'Sale',
            primaryKey: 'id',
            columns: {
                id: 'INTEGER',
                Region: 'TEXT',
                Month: 'INTEGER',
                Revenue: 'DECIMAL?',
                Cost: 'DECIMAL?',
                Profit: 'DECIMAL?',
                Price: 'DECIMAL',
                Units: 'INTEGER',
                'Total cost': 'DECIMAL?',
                مبلغ: 'DECIMAL?'
            }
        }
    ]
};

/** The three sample rows of P1. */
const rows = [
    { id: 1, Region: 'North', Month: 1, Revenue: 20, Cost: 5, Profit: 15, Price: 10, Units: 2 },
    { id: 2, Region: 'North', Month: 2, Revenue: 20, Cost: 8, Profit: 12, Price: 5, Units: 4 },
    { id: 3, Region: 'South', Month: 1, Revenue: 8, Cost: 10, Profit: -2, Price: 8, Units: 1 }
];

const sets = [[], ['Region'], ['Region', 'Month']];

/** One expected answer for each group of `sets` over `rows`. */
const groups = (all: unknown, north: unknown, south: unknown, north1: unknown, north2: unknown, south1: unknown) => ({
    '': all,
    'Region=North': north,
    'Region=South': south,
    'Region=North,Month=1': north1,
    'Region=North,Month=2': north2,
    'Region=South,Month=1': south1
});

const pivot = (name: string, expr: string, expect?: Record<string, unknown>): DifferentialCase => ({
    name,
    schema,
    expr,
    group: { rows, sets },
    ...(expect ? { expect } : {})
});

export const cases: DifferentialCase[] = [
    pivot('profit: SUM(.Revenue) - SUM(.Cost)', 'SUM(.Revenue) - SUM(.Cost)', groups(25, 27, -2, 15, 12, -2)),
    pivot('SUM of a product is per row', 'SUM(.Price * .Units)', groups(48, 40, 8, 20, 20, 8)),
    pivot('a product of SUMs is per group', 'SUM(.Price) * SUM(.Units)', groups(161, 90, 8, 20, 20, 8)),
    pivot('a margin: SUM(.Profit) / SUM(.Revenue)', 'SUM(.Profit) / SUM(.Revenue)', groups('0.5208333333333333', 0.675, -0.25, 0.75, 0.6, -0.25)),
    pivot('AVG is the exact sum divided by the count', 'AVG(.Units)', groups('2.3333333333333333', 3, 1, 2, 4, 1)),
    pivot('COUNT(.) is the number of rows', 'COUNT(.)', groups(3, 2, 1, 1, 1, 1)),
    pivot('MIN and MAX', 'MAX(.Price) - MIN(.Price)', groups(5, 5, 0, 0, 0, 0)),
    pivot('integer division and modulo', 'SUM(.Units) \\ 2 + SUM(.Units) % 2', groups(4, 3, 1, 1, 2, 1)),
    pivot(
        'if over aggregates, with a text answer',
        'if SUM(.Revenue) > 20 { "big" } else { "small" }',
        groups('big', 'big', 'small', 'small', 'small', 'small')
    ),
    pivot('switch over COUNT', 'switch COUNT(.) { 1 => "one", 2 => "two", _ => "many" }', groups('many', 'two', 'one', 'one', 'one', 'one')),
    pivot('a decimal and a negative literal', 'SUM(.Revenue * 1.5) - -2', groups(74, 62, 14, 32, 32, 14)),
    pivot('quoted and Persian column names', 'SUM(.`Total cost`) + SUM(.مبلغ) + COUNT(.)', groups(null, null, null, null, null, null)),
    pivot(
        'text literals with a quote, a semicolon, a comment and a backslash',
        'if COUNT(.) > 1 { "it\'s; -- /* not a comment" } else { "a \\\\ b" }',
        groups("it's; -- /* not a comment", "it's; -- /* not a comment", 'a \\ b', 'a \\ b', 'a \\ b', 'a \\ b')
    ),
    {
        name: 'a zero denominator gives null, and the statement does not fail',
        schema,
        expr: 'SUM(.Profit) / SUM(.Revenue)',
        group: {
            rows: [
                { id: 1, Region: 'North', Month: 1, Revenue: 0, Profit: -3 },
                { id: 2, Region: 'South', Month: 1, Revenue: 10, Profit: 4 }
            ],
            sets: [[], ['Region']]
        },
        expect: { '': 0.1, 'Region=North': null, 'Region=South': 0.4 }
    },
    {
        name: 'AVG rounds to 16 decimals like the interpreter (Postgres AVG keeps 20)',
        schema,
        expr: 'AVG(.Units)',
        group: {
            rows: [
                { id: 1, Units: 1 },
                { id: 2, Units: 1 },
                { id: 3, Units: 0 }
            ]
        },
        expect: { '': '0.6666666666666667' }
    },
    {
        name: 'modulo and integer division by zero give null',
        schema,
        expr: 'SUM(.Units) % SUM(.Month) + SUM(.Units) \\ SUM(.Month)',
        group: {
            rows: [
                { id: 1, Region: 'North', Month: 0, Units: 3 },
                { id: 2, Region: 'South', Month: 2, Units: 5 }
            ],
            sets: [[], ['Region']]
        },
        expect: { '': 4, 'Region=North': null, 'Region=South': 3 }
    },
    {
        name: 'a group where every value is null looks empty: SUM is null, COUNT is 0',
        schema,
        expr: 'if COUNT(.Revenue) == 0 { -1 } else { SUM(.Revenue) }',
        group: {
            rows: [
                { id: 1, Region: 'North', Revenue: null },
                { id: 2, Region: 'South', Revenue: 5 }
            ],
            sets: [[], ['Region']]
        },
        expect: { '': 5, 'Region=North': -1, 'Region=South': 5 }
    },
    {
        name: 'no rows at all: COUNT(.) is 0, SUM is null',
        schema,
        expr: 'COUNT(.) + 0',
        group: { rows: [], sets: [[]] },
        expect: { '': 0 }
    },
    {
        name: 'no rows at all: SUM is null',
        schema,
        expr: 'SUM(.Revenue)',
        group: { rows: [], sets: [[]] },
        expect: { '': null }
    }
];
