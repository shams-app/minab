/**
 * The language on one page: the cheat sheet at /reference, the drawer in
 * the workbench, and the keyword hovers in the editor all read this.
 * Every entry points at the spec section that is its authority
 * (`docs/query-language-spec.md`); snippets are illustrative, and entries
 * with `exampleId` open a verified, runnable example.
 */

export interface CheatEntry {
    id: string;
    title: string;
    /** The construct's shape, as code. */
    syntax: string;
    /** Markdown, a sentence or three. */
    description: string;
    specRef: string;
    /** Tokens this entry documents — hovering any of them in the editor shows this entry. */
    keywords?: string[];
    /** A gallery example that shows this construct running. */
    exampleId?: string;
    status?: 'check-only';
}

export interface CheatSection {
    id: string;
    title: string;
    intro: string;
    entries: CheatEntry[];
}

export const SPEC_URL = 'https://github.com/shams-app/minab/blob/main/docs/query-language-spec.md';
export const SHOWCASE_URL = 'https://github.com/shams-app/minab/blob/main/docs/showcase.md';
export const REPO_URL = 'https://github.com/shams-app/minab';

export const cheatsheet: CheatSection[] = [
    {
        id: 'sigils',
        title: 'Sigils',
        intro: 'One character tells you which record an expression is about. These are what make Minab read like Minab.',
        entries: [
            {
                id: 'current-record',
                title: 'Current record',
                syntax: '.field    .customer.name',
                description:
                    '`.` is the row in scope — the row being filtered, selected or validated. `.field` reads a column; more dots walk `ref` relations.',
                specRef: '§2',
                exampleId: 'first-query'
            },
            {
                id: 'field-value',
                title: 'Field value',
                syntax: '$',
                description: 'The value under validation in a **field-level rule**. The host decides which field and its type.',
                specRef: '§6.2',
                exampleId: 'customer-exists'
            },
            {
                id: 'parent-record',
                title: 'Parent record',
                syntax: '^    ^.room_id',
                description: 'The row one scope level up — inside `#Booking[…]`, `^` is the booking being validated while `.` is each candidate.',
                specRef: '§2.2',
                exampleId: 'booking-overlap'
            },
            {
                id: 'named-scope',
                title: 'Named scope / whole table',
                syntax: '#Booking    #Booking[.room_id == ^.room_id]',
                description: 'An alias declared with `AS`, or — when no alias has that name — the whole table, opened inline. Square brackets filter it.',
                specRef: '§3.3',
                exampleId: 'booking-overlap'
            },
            {
                id: 'group-key',
                title: 'Group key',
                syntax: 'KEY    KEY.name',
                description: 'After `GROUPBY`, the group itself. Grouping by a relation makes `KEY` that related row.',
                specRef: '§2.2',
                keywords: ['KEY'],
                exampleId: 'top-customers'
            },
            {
                id: 'function-call',
                title: 'User function call',
                syntax: 'discounted(200, 15)',
                description: 'User functions are called by name. A function name needs a lowercase letter; built-ins are ALL CAPS, so the two never collide.',
                specRef: '§8.4',
                exampleId: 'discounted-total'
            },
            {
                id: 'index',
                title: 'Position',
                syntax: '.$index',
                description: 'The position of the current element while iterating an array.',
                specRef: '§3.5',
                keywords: ['.$index'],
                status: 'check-only'
            }
        ]
    },
    {
        id: 'pipeline',
        title: 'Pipeline queries',
        intro: 'Clauses always come in this order. The whole pipeline compiles to one SQL statement.',
        entries: [
            {
                id: 'from',
                title: 'FROM … AS',
                syntax: 'FROM Order AS o',
                description: 'The source table, optionally aliased. The alias names the row in `JOIN` conditions and as `#o`.',
                specRef: '§4.1',
                keywords: ['FROM', 'AS'],
                exampleId: 'first-query'
            },
            {
                id: 'join',
                title: 'JOIN · LEFTJOIN · CROSSJOIN',
                syntax: 'JOIN Shipment AS s ON o.tracking_code == s.tracking_code',
                description: 'For tables the schema doesn’t relate. When a `ref` exists, walk it with dots instead.',
                specRef: '§4.3',
                keywords: ['JOIN', 'LEFTJOIN', 'CROSSJOIN', 'ON'],
                exampleId: 'shipping-report'
            },
            {
                id: 'where',
                title: 'WHERE',
                syntax: 'WHERE .status == "shipped" AND .total > 100',
                description: 'Keeps the rows for which the condition is true.',
                specRef: '§4.1',
                keywords: ['WHERE'],
                exampleId: 'first-query'
            },
            {
                id: 'groupby',
                title: 'GROUPBY · HAVING',
                syntax: 'GROUPBY .customer\nHAVING SUM(.total) > 1000\n\nGROUPBY .status AS s',
                description: 'Groups rows; aggregates then apply per group. `HAVING` filters groups the way `WHERE` filters rows. A key may take a name with `AS`.',
                specRef: '§4.3',
                keywords: ['GROUPBY', 'HAVING'],
                exampleId: 'top-customers'
            },
            {
                id: 'select',
                title: 'SELECT · DISTINCT · *',
                syntax: 'SELECT .id, .customer.name AS customer\nSELECT DISTINCT .status\nSELECT *',
                description: 'What each output row holds. `AS` names a column; `DISTINCT` drops duplicates.',
                specRef: '§4.1',
                keywords: ['SELECT', 'DISTINCT'],
                exampleId: 'order-statuses'
            },
            {
                id: 'orderby',
                title: 'ORDERBY · LIMIT · OFFSET',
                syntax: 'ORDERBY .total DESC\nLIMIT 20 OFFSET 40',
                description: 'Sort (`ASC` is the default), then keep a window of rows. Output aliases work in `ORDERBY`.',
                specRef: '§4.1',
                keywords: ['ORDERBY', 'ASC', 'DESC', 'LIMIT', 'OFFSET'],
                exampleId: 'room-occupancy'
            }
        ]
    },
    {
        id: 'rules',
        title: 'Validation rules',
        intro: 'A program without `FROM` whose answer is `true` or `false` is a rule. The host decides which table it guards.',
        entries: [
            {
                id: 'record-rule',
                title: 'Record-level rule',
                syntax: '.end_date > .start_date',
                description:
                    'A condition over `.` — the record about to be saved. Parts that need other rows are pushed down to the database; the rest is answered in memory.',
                specRef: '§6.1',
                exampleId: 'booking-overlap'
            },
            {
                id: 'field-rule',
                title: 'Field-level rule',
                syntax: '$ >= 0 AND $ <= .customer.credit_limit',
                description: 'A condition over `$`, one field’s value. The rest of the record is still reachable through `.`.',
                specRef: '§6.2',
                exampleId: 'order-amount'
            },
            {
                id: 'tail',
                title: 'Declarations, then a tail',
                syntax: 'let cap: DECIMAL = 5000;\n.credit_limit <= cap',
                description: 'Any program is declarations (`let`, `fn`) followed by one final expression or query — its answer.',
                specRef: '§6.3',
                exampleId: 'tiered-credit'
            }
        ]
    },
    {
        id: 'expressions',
        title: 'Operators',
        intro: 'From loosest to tightest binding. Comparisons don’t chain.',
        entries: [
            {
                id: 'logical',
                title: 'Logical',
                syntax: 'a OR b    a AND b    NOT a',
                description: '`AND` and `OR` short-circuit — a rule whose local half already fails never asks the database.',
                specRef: '§5.1',
                keywords: ['AND', 'OR', 'NOT'],
                exampleId: 'order-amount'
            },
            {
                id: 'comparison',
                title: 'Comparison',
                syntax: '==  !=  <  <=  >  >=    IN [..]    LIKE "%x%"',
                description: 'Both sides must have compatible types — `INTEGER` and `DECIMAL` mix freely; anything else needs a `CAST`.',
                specRef: '§5.1',
                keywords: ['IN', 'LIKE'],
                exampleId: 'strict-types'
            },
            {
                id: 'arithmetic',
                title: 'Arithmetic',
                syntax: '+  -  *  /  %  \\\n7 / 2 → 3.5    7 \\ 2 → 3',
                description: 'On numbers. `/` always gives a `DECIMAL`; `\\` is integer division, cut toward zero, and always gives an `INTEGER`. `null` propagates through arithmetic (§7.7).',
                specRef: '§5.1'
            },
            {
                id: 'filter',
                title: 'Filter a collection',
                syntax: '.orders[.status == "cancelled"]',
                description: 'Square brackets after a collection keep the elements for which the condition holds. Inside, `.` is each element.',
                specRef: '§3.2',
                exampleId: 'cancelled-orders-limit'
            },
            {
                id: 'shape',
                title: 'JSON shape tests',
                syntax: 'x is object    x isnot null',
                description: 'Test a JSON value’s kind: `null`, `array`, `object`, `string`, `number` or `boolean`.',
                specRef: '§5.6',
                keywords: ['is', 'isnot', 'array', 'object', 'string', 'number', 'boolean'],
                exampleId: 'json-shape'
            }
        ]
    },
    {
        id: 'types',
        title: 'Types',
        intro: 'Minab never converts types behind your back.',
        entries: [
            {
                id: 'base-types',
                title: 'Base types',
                syntax: 'TEXT  CITEXT  INTEGER  DECIMAL  BOOLEAN\nDATE  TIME  DATETIME  UUID  JSON',
                description: '`CITEXT` compares case-insensitively; `UUID` supports equality only.',
                specRef: '§7.2',
                keywords: ['TEXT', 'CITEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'UUID', 'JSON'],
                exampleId: 'email-lookup'
            },
            {
                id: 'modifiers',
                title: 'Nullable and arrays',
                syntax: 'TEXT?    INTEGER[]    TEXT?[]?',
                description: '`?` allows null; `[]` makes an array; `?` after `[]` allows the array itself to be null.',
                specRef: '§7.2'
            },
            {
                id: 'cast',
                title: 'CAST',
                syntax: 'CAST("2026-09-01" AS DATE)',
                description: 'The only way to change a type. There is no date literal — cast a string.',
                specRef: '§5.5',
                keywords: ['CAST'],
                exampleId: 'recent-orders'
            },
            {
                id: 'literals',
                title: 'Literals',
                syntax: '"text"  \'text\'  42  12.5  true  false  null\n[1, 2]  { key: value }  (a, b)',
                description: 'Strings, numbers, booleans, `null`, lists, JSON objects and tuples.',
                specRef: '§5.2',
                keywords: ['true', 'false', 'null', 'NULL']
            }
        ]
    },
    {
        id: 'builtins',
        title: 'Built-in functions',
        intro: 'Called by name, in ALL CAPS. The first group takes one collection. The text, null and number functions take values.',
        entries: [
            {
                id: 'count',
                title: 'COUNT',
                syntax: 'COUNT(.orders)  →  INTEGER',
                description: 'How many rows or elements.',
                specRef: '§5.3.1',
                keywords: ['COUNT'],
                exampleId: 'never-ordered'
            },
            {
                id: 'sum',
                title: 'SUM · AVG',
                syntax: 'SUM(.orders.total)  →  N\nAVG(.price)  →  DECIMAL',
                description: 'Over a numeric column spread across a collection.',
                specRef: '§5.3.1',
                keywords: ['SUM', 'AVG'],
                exampleId: 'order-items'
            },
            {
                id: 'minmax',
                title: 'MIN · MAX',
                syntax: 'MAX(.orders.total)  →  T',
                description: 'Over an orderable column: text, numbers, dates, times.',
                specRef: '§5.3.1',
                keywords: ['MIN', 'MAX']
            },
            {
                id: 'exists',
                title: 'EXISTS',
                syntax: 'EXISTS(#Customer[.id == $])  →  BOOLEAN',
                description: 'Whether the collection has any element — pushed down as one `SELECT EXISTS`.',
                specRef: '§5.3.1',
                keywords: ['EXISTS'],
                exampleId: 'customer-exists'
            },
            {
                id: 'allany',
                title: 'ALL · ANY',
                syntax: 'ALL(flags)  ANY(flags)  →  BOOLEAN',
                description: 'Over a collection of booleans.',
                specRef: '§5.3.1',
                keywords: ['ALL', 'ANY']
            },
            {
                id: 'text-functions',
                title: 'LOWER · UPPER · TRIM · LENGTH',
                syntax: 'LENGTH(TRIM(.name))  →  INTEGER\nUPPER(.code)  →  TEXT',
                description: 'Text helpers. `LENGTH` counts characters (code points). `null` gives `null`.',
                specRef: '§5.3.1',
                keywords: ['LOWER', 'UPPER', 'TRIM', 'LENGTH']
            },
            {
                id: 'text-search',
                title: 'SUBSTRING · REPLACE · STARTS_WITH · ENDS_WITH · CONTAINS',
                syntax: 'SUBSTRING(.name, 1, 3)  →  TEXT\nREPLACE(.name, " ", "-")  →  TEXT\nSTARTS_WITH(.sku, "BR-")  →  BOOLEAN\nCONTAINS(.name, "%")  →  BOOLEAN',
                description: '`SUBSTRING` counts from 1; `length` is optional. The searches ignore case for `CITEXT`, and `%` and `_` are plain characters.',
                specRef: '§5.3.1',
                keywords: ['SUBSTRING', 'REPLACE', 'STARTS_WITH', 'ENDS_WITH', 'CONTAINS']
            },
            {
                id: 'coalesce',
                title: 'COALESCE · GREATEST · LEAST',
                syntax: 'COALESCE(.nickname, .name)  →  T\nGREATEST(.a, .b, 0)  →  T',
                description: '`COALESCE` gives the first value that is not `null`. `GREATEST` and `LEAST` ignore `null`.',
                specRef: '§5.3.1',
                keywords: ['COALESCE', 'GREATEST', 'LEAST']
            },
            {
                id: 'number-functions',
                title: 'ROUND · ABS · FLOOR · CEIL',
                syntax: 'ROUND(.total * 1.09, 2)  →  N\nABS(.delta)  →  N\nFLOOR(.total)  →  INTEGER',
                description: '`ROUND` goes half away from zero and is exact for `DECIMAL`. `digits` is optional.',
                specRef: '§5.3.1',
                keywords: ['ROUND', 'ABS', 'FLOOR', 'CEIL']
            },
            {
                id: 'now-today',
                title: 'NOW · TODAY',
                syntax: '.placed_at < NOW()  →  BOOLEAN\n.due_date < TODAY()  →  BOOLEAN',
                description: '`NOW()` is the instant the run started (the same everywhere in one run). `TODAY()` is its date in the time zone of the run.',
                specRef: '§5.3.1',
                keywords: ['NOW', 'TODAY']
            },
            {
                id: 'date-parts',
                title: 'YEAR · MONTH · DAY · HOUR · MINUTE',
                syntax: 'YEAR(.placed_at) == 2026  →  BOOLEAN\nHOUR(.placed_at)  →  INTEGER',
                description: 'Parts of a `DATE`, a `TIME` or a `DATETIME`. A `DATETIME` is read in the time zone of the run.',
                specRef: '§5.3.1',
                keywords: ['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE']
            },
            {
                id: 'date-math',
                title: 'DATE_ADD · DATE_DIFF',
                syntax: 'DATE_ADD(.start_date, 1, "month")  →  DATE\nDATE_DIFF(TODAY(), .paid_on, "day") > 30  →  BOOLEAN',
                description:
                    'Units: `"year"`, `"month"`, `"week"`, `"day"`, and for a `DATETIME` also `"hour"`, `"minute"`, `"second"`. The unit is a text literal. Month ends clamp: Jan 31 + 1 month is Feb 28. `DATE_DIFF` truncates toward zero.',
                specRef: '§5.3.1',
                keywords: ['DATE_ADD', 'DATE_DIFF']
            }
        ]
    },
    {
        id: 'declarations',
        title: 'Variables and functions',
        intro: 'Everything is typed; nothing is inferred from a later use.',
        entries: [
            {
                id: 'let',
                title: 'let',
                syntax: 'let limit: DECIMAL = 1000;\nlet top: DECIMAL = (FROM Order SELECT .total ORDERBY .total DESC LIMIT 1);',
                description: 'A typed variable. A parenthesized query can initialize it.',
                specRef: '§7.1',
                keywords: ['let'],
                exampleId: 'biggest-order'
            },
            {
                id: 'fn',
                title: 'fn',
                syntax: 'fn discounted(total: DECIMAL, rate: DECIMAL): DECIMAL {\n    total - (total * rate / 100)\n}',
                description: 'Typed parameters and result. The body’s last expression is the value — no `return`.',
                specRef: '§8',
                keywords: ['fn'],
                exampleId: 'discounted-total'
            }
        ]
    },
    {
        id: 'control-flow',
        title: 'Control flow',
        intro: '`if` and `switch` are expressions: they produce values.',
        entries: [
            {
                id: 'if',
                title: 'if · else',
                syntax: 'if .tier == "gold" { 5000 } else if .tier == "silver" { 2500 } else { 1000 }',
                description: 'An expression. Without `else`, the result is nullable.',
                specRef: '§9.1',
                keywords: ['if', 'else'],
                exampleId: 'tiered-credit'
            },
            {
                id: 'switch',
                title: 'switch',
                syntax: 'switch .status {\n    "high" => .total > 500,\n    "normal", "low" => .total > 5000,\n    _ => false\n}',
                description: 'Literal cases, several values per arm, `_` as the required default.',
                specRef: '§9.2',
                keywords: ['switch', '_'],
                exampleId: 'order-status-switch'
            },
            {
                id: 'if-statement',
                title: 'if! (statement form)',
                syntax: 'if! count > 0 { flagged = flagged + 1; }',
                description: 'Runs statements for their effect rather than producing a value.',
                specRef: '§9.1.1',
                keywords: ['if!'],
                status: 'check-only'
            },
            {
                id: 'loops',
                title: 'Loops',
                syntax: 'loop i from 1 to 10 by 2 { … }\nloop order in #Order where .total > 0 { … }\nloop remaining > 0 { … }',
                description: 'Range, for-in and conditional forms, with `break` and `continue` (optionally labelled).',
                specRef: '§9.4',
                keywords: ['loop', 'from', 'to', 'by', 'in', 'where', 'break', 'continue'],
                exampleId: 'overdue-loop',
                status: 'check-only'
            }
        ]
    },
    {
        id: 'writes',
        title: 'Writes',
        intro: 'Declarative data manipulation. Fully type-checked; not executed yet.',
        entries: [
            {
                id: 'update',
                title: 'UPDATE … SET',
                syntax: 'UPDATE #Customer[.country == "TR"]\nSET { checked: true, points +: 10 };',
                description: 'Set operators: `:` assign, `+:` `-:` `*:` `/:` compound, `:|` default.',
                specRef: '§10.3',
                keywords: ['UPDATE', 'SET'],
                exampleId: 'order-dml',
                status: 'check-only'
            },
            {
                id: 'insert',
                title: 'INSERT … VALUES',
                syntax: 'INSERT #Archive VALUES #Customer[.country == "TR"];',
                description: 'From a JSON object, a filtered table, or a query.',
                specRef: '§10.1',
                keywords: ['INSERT', 'VALUES'],
                exampleId: 'order-dml',
                status: 'check-only'
            },
            {
                id: 'delete',
                title: 'DELETE',
                syntax: 'DELETE #Session WHERE .expired ORDERBY .created LIMIT 100;',
                description: 'Filtered, optionally ordered and limited.',
                specRef: '§10.2',
                keywords: ['DELETE'],
                status: 'check-only'
            }
        ]
    }
];

/** Keyword → the entry that documents it, for editor hovers. */
export const keywordDocs: ReadonlyMap<string, CheatEntry> = (() => {
    const map = new Map<string, CheatEntry>();
    for (const section of cheatsheet) {
        for (const entry of section.entries) {
            for (const keyword of entry.keywords ?? []) if (!map.has(keyword)) map.set(keyword, entry);
        }
    }
    return map;
})();
