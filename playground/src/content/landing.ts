/**
 * The landing page's words. Kept apart from the components so copy can be
 * edited (or handed to a designer) without touching layout code. The code
 * snippets reference gallery examples, so they are verified by the content
 * tests and the SQL shown next to them is compiled live, never pasted.
 */

import { REPO_URL, SPEC_URL } from './reference/cheatsheet.js';

export const landing = {
    eyebrow: 'A query and validation language',
    headline: 'Say what you mean about your data.',
    subhead:
        'Minab is one small language for two jobs: querying relational data, and validating the records you’re about to save. It type-checks everything before it runs anything, and compiles to plain PostgreSQL.',
    primaryCta: { label: 'Open the playground', to: '/play' },
    secondaryCta: { label: 'Take the tour · 10 min', to: '/learn' },
    runsHere: 'Everything on this site runs in your browser — the Minab toolchain in a Web Worker, and a real PostgreSQL compiled to WebAssembly.',

    /** The hero's live demo: three gallery examples, each shown with its real output. */
    demo: [
        { exampleId: 'top-customers', label: 'Query', caption: 'A pipeline that walks a relation — no JOIN written.' },
        { exampleId: 'booking-overlap', label: 'Rule', caption: 'A validation rule: only the correlated check reaches the database.' },
        { exampleId: 'strict-types', label: 'Types', caption: 'Mistakes are caught before anything runs.' }
    ],

    layers: {
        title: 'Two layers, one expression language',
        body: 'The same `.`-for-the-current-row expressions work in a `FROM … WHERE … SELECT` pipeline and in a bare validation rule. Learn it once.',
        query: { title: 'Query', exampleId: 'first-query', body: 'Pipelines read top to bottom and compile to one parameterized SQL statement.' },
        rule: { title: 'Validate', exampleId: 'booking-overlap', body: 'A condition over `.` guards a record; `$` guards a single field. The host decides which.' }
    },

    sigils: {
        title: 'Every character pulls its weight',
        body: 'Sigils say *which* record an expression is about, so scoping is visible at a glance instead of buried in aliases.',
        items: [
            { sigil: '.', token: 'sigil-record', name: 'current record', example: '.customer.name' },
            { sigil: '$', token: 'sigil-field', name: 'value under validation', example: '$ <= .credit_limit' },
            { sigil: '^', token: 'sigil-parent', name: 'one scope up', example: '.room_id == ^.room_id' },
            { sigil: '#', token: 'sigil-alias', name: 'a table, inline', example: '#Booking[.id != ^.id]' },
            { sigil: 'KEY', token: 'sigil-key', name: 'the group', example: 'KEY.name' },
            { sigil: '&', token: 'sigil-call', name: 'your functions', example: '&discounted(200, 15)' }
        ]
    },

    pipeline: {
        title: 'How a program runs',
        steps: [
            { title: 'Parse', body: 'A Langium grammar, LL(k)-checked, with keyword casing as a deliberate convention.' },
            { title: 'Resolve & check', body: 'Every `.field` against the host’s schema. No implicit coercion, null rules made explicit.' },
            { title: 'Compile', body: 'Pipelines become one parameterized PostgreSQL statement. Relations become correlated lookups.' },
            { title: 'Run — hybrid', body: 'Rules are evaluated next to the record; only the smallest table-touching pieces are pushed down.' }
        ]
    },

    comparison: {
        title: 'What you write, what runs',
        body: 'The SQL on the right is compiled live from the Minab on the left — the same text `minab compile` prints.',
        exampleId: 'top-customers'
    },

    features: [
        { icon: 'lock', title: 'No implicit coercion', body: 'TEXT never quietly becomes a number. A CAST says what you mean, and the checker points at the exact span when you don’t.' },
        { icon: 'layers', title: 'Relations without joins', body: 'The schema knows how tables link, so `.customer.country` just works — and still compiles to an indexed lookup.' },
        { icon: 'bolt', title: 'Rules run next to the record', body: 'A rule answers what it can from the record in memory and asks the database only what it must.' },
        { icon: 'code', title: 'Real tooling', body: 'A language server with diagnostics, hovers and go-to-definition, a VS Code extension, and a CLI.' },
        { icon: 'check', title: 'Checked before it runs', body: 'Parse, scope, types — then execution. Loops and writes already type-check, ahead of running.' },
        { icon: 'database', title: 'Runs right here', body: 'This site executes every example against PostgreSQL compiled to WebAssembly, in your tab.' }
    ],

    cta: {
        title: 'Try it on real data',
        body: 'Every example in the gallery runs, the tour takes about ten minutes, and the scratchpad is wired to a live database.',
        primary: { label: 'Open the playground', to: '/play' },
        secondary: { label: 'Browse examples', to: '/examples' }
    },

    footer: {
        author: 'Hamed Zakery Miab',
        // TODO(hamed): your portfolio URL.
        authorUrl: '',
        links: [
            { label: 'GitHub', href: REPO_URL },
            { label: 'Language spec', href: SPEC_URL },
            { label: 'VS Code extension', href: `${REPO_URL}/tree/main/vscode-extension` }
        ],
        note: 'Built with Langium, PGlite, Monaco and React.'
    }
} as const;
