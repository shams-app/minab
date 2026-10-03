import { ITEM_SCHEMA as schema, type DifferentialCase } from '../harness.js';

/**
 * C5: `TEXT` and `CITEXT` are one text family (D15). A comparison ignores
 * case when either side is `CITEXT`. `LIKE` follows Postgres: `%`, `_`, and
 * `\` to escape. In a Minab string, `\\` is one backslash.
 */
const record = { id: 1, s: 'Hello', ci: 'ada@example.com', t: null };
const lowerS = { ...record, s: 'ada@example.com' };

const on = (name: string, expr: string, expect: unknown, rec: Record<string, unknown> = record): DifferentialCase => ({
    name,
    schema,
    record: rec,
    expr,
    expect
});

export const cases: DifferentialCase[] = [
    // ---- CITEXT against a text literal -----------------------------------
    on('CITEXT == text literal, other case', '.ci == "Ada@Example.COM"', true),
    on('text literal == CITEXT (sides swapped)', '"ADA@EXAMPLE.COM" == .ci', true),
    on('CITEXT == a different text', '.ci == "bob@example.com"', false),
    on('CITEXT != text literal, other case', '.ci != "ADA@example.com"', false),
    on('CITEXT != a different text', '.ci != "bob@example.com"', true),
    on('CITEXT == CITEXT', '.ci == .ci', true),

    // ---- TEXT against CITEXT ---------------------------------------------
    on('TEXT column == CITEXT column ignores case', '.s == .ci', true, {
        ...record,
        s: 'ADA@Example.com'
    }),
    on('CITEXT column == TEXT column ignores case', '.ci == .s', true, {
        ...record,
        s: 'ADA@Example.com'
    }),
    on('TEXT column == CITEXT column, different text', '.s == .ci', false),
    on('TEXT column == TEXT literal is case-sensitive', '.s == "hello"', false),
    on('TEXT column != TEXT literal is case-sensitive', '.s != "hello"', true),

    // ---- null ------------------------------------------------------------
    on('CITEXT == null', '.ci == null', false),
    on('nullable TEXT == CITEXT', '.t == .ci', false),

    // ---- IN --------------------------------------------------------------
    on('CITEXT IN list of text ignores case', '.ci IN ["ADA@EXAMPLE.COM"]', true),
    on('CITEXT IN list that misses', '.ci IN ["x@example.com", "y@example.com"]', false),
    on('TEXT column IN list is case-sensitive', '.s IN ["hello"]', false),
    on('TEXT column IN list of one match', '.s IN ["Hello"]', true),
    on('TEXT literal IN list with a CITEXT item', '"ADA@EXAMPLE.COM" IN [.ci]', true),
    on('TEXT column IN list with a CITEXT item', '.s IN [.ci]', true, {
        ...record,
        s: 'ADA@EXAMPLE.COM'
    }),

    // ---- ordering --------------------------------------------------------
    on('CITEXT < text compares ignoring case', '.ci < "B"', true),
    on('CITEXT >= text compares ignoring case', '.ci >= "ADA@EXAMPLE.COM"', true),
    on('CITEXT > text, equal ignoring case', '.ci > "ADA@EXAMPLE.COM"', false),
    on('TEXT < text, same letters, last one differs', '.s < "Hellp"', true),

    // ---- LIKE on TEXT: case-sensitive ------------------------------------
    on('TEXT LIKE is case-sensitive', '.s LIKE "HEL%"', false),
    on('TEXT LIKE matches the same case', '.s LIKE "Hel%"', true),
    on('LIKE % matches an empty run', '.s LIKE "Hello%"', true),
    on('LIKE % in the middle', '.s LIKE "H%o"', true),
    on('LIKE _ matches one character', '.s LIKE "Hell_"', true),
    on('LIKE _ does not match two characters', '.s LIKE "Hel_"', false),
    on('LIKE _ does not match zero characters', '.s LIKE "Hello_"', false),
    on('LIKE needs the whole text', '.s LIKE "ell"', false),
    on('LIKE does not read regex characters', '.s LIKE "H.llo"', false),
    on('LIKE with a literal dot in the text', '.s LIKE "a.c"', true, {
        ...record,
        s: 'a.c'
    }),
    on('LIKE dot does not match another character', '.s LIKE "a.c"', false, {
        ...record,
        s: 'abc'
    }),
    on('LIKE _ matches one Persian letter', '.s LIKE "_لام"', true, {
        ...record,
        s: 'سلام'
    }),
    on('LIKE _ does not match two Persian letters', '.s LIKE "_ام"', false, {
        ...record,
        s: 'سلام'
    }),
    on('LIKE % matches Persian text', '.s LIKE "%لام"', true, {
        ...record,
        s: 'سلام'
    }),

    // ---- LIKE with escape ------------------------------------------------
    on('escaped % matches a percent sign', '.s LIKE "50\\\\%"', true, {
        ...record,
        s: '50%'
    }),
    on('escaped % does not match other text', '.s LIKE "50\\\\%"', false, {
        ...record,
        s: '500'
    }),
    on('unescaped % matches both', '.s LIKE "50%"', true, {
        ...record,
        s: '500'
    }),
    on('escaped _ matches an underscore', '.s LIKE "a\\\\_c"', true, {
        ...record,
        s: 'a_c'
    }),
    on('escaped _ does not match another character', '.s LIKE "a\\\\_c"', false, {
        ...record,
        s: 'abc'
    }),
    on('escaped backslash matches one backslash', '.s LIKE "a\\\\\\\\c"', true, {
        ...record,
        s: 'a\\c'
    }),
    on('escape before a plain character', '.s LIKE "\\\\H%"', true),
    on('a pattern that ends with a backslash, text used up: false', '.s LIKE "Hello\\\\"', false),
    {
        name: 'a pattern that ends with a backslash, text left: fails',
        schema,
        record: { ...record, s: 'Hello!' },
        expr: '.s LIKE "Hello\\\\"',
        expect: { error: 'other' }
    },
    {
        name: 'a percent then a trailing backslash fails',
        schema,
        record,
        expr: '.s LIKE "%\\\\"',
        expect: { error: 'other' }
    },

    // ---- LIKE with CITEXT ------------------------------------------------
    on('CITEXT LIKE ignores case', '.ci LIKE "%@EXAMPLE.com"', true),
    on('CITEXT LIKE with _', '.ci LIKE "ADA_example.com"', true),
    on('CITEXT LIKE that misses', '.ci LIKE "bob%"', false),
    on('TEXT column LIKE CITEXT column ignores case', '.s LIKE .ci', true, {
        ...lowerS,
        s: 'ADA@example.COM'
    }),
    on('TEXT literal LIKE CITEXT pattern', '"ADA@EXAMPLE.COM" LIKE .ci', true),
    on('CITEXT LIKE an escaped %', '.ci LIKE "50\\\\%"', true, {
        ...record,
        ci: '50%'
    }),
    on('CITEXT LIKE an escaped % does not match 500', '.ci LIKE "50\\\\%"', false, { ...record, ci: '500' })
];
