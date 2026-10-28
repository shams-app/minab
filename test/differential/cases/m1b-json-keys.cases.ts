import type { DifferentialCase } from '../harness.js';

/**
 * Shamsine card M.1b: a key of a `JSON` value is read with `.key` or `["key"]` (spec §7.3.1).
 * The fields are the six `JSON` shapes of Shamsine: `location`, `address`, `attachment`, `icon`, `canvas`
 * and `timeTracking`. A missing key, a key of a value that is not an object, and a JSON `null` are all `null`.
 * `COUNT` of a `JSON` value counts the elements of an array and is 0 for anything else.
 */
const schema = {
    tables: [
        {
            name: 'Rec',
            primaryKey: 'id',
            columns: {
                id: 'INTEGER',
                label: 'TEXT',
                location: 'JSON?',
                address: 'JSON?',
                attachment: 'JSON?',
                icon: 'JSON?',
                canvas: 'JSON?',
                tracking: 'JSON?'
            }
        }
    ]
};

const record = {
    id: 1,
    label: 'name',
    location: { lat: 35.75, lng: 51.41, address: null },
    address: { text: 'Tehran, Valiasr', parts: null, lat: 35.7, lng: 51.4 },
    attachment: { objectKey: 'attachments/ws/ds/a1', name: 'plan.pdf', size: 120000, mimeType: 'application/pdf', 'file name': 'plan 1' },
    icon: { name: 'home', fill: 1, color: '#336699' },
    canvas: {
        width: 800,
        height: 600,
        strokes: [
            {
                points: [
                    [1, 2],
                    [3, 4]
                ]
            }
        ]
    },
    tracking: {
        sessions: [
            { id: 's1', userId: 'usr_1', start: '2026-10-01T08:00:00.000Z', end: '2026-10-01T09:30:00.000Z', manual: true },
            { id: 's2', userId: 'usr_2', start: '2026-10-02T08:00:00.000Z' }
        ]
    }
};

const base = { schema, record };

export const cases: DifferentialCase[] = [
    // The target examples of the card.
    { name: 'a comparison on location.lat', ...base, expr: 'CAST(.location.lat AS DECIMAL) > 35.7', expect: true },
    { name: 'location.lat as a decimal', ...base, expr: 'CAST(.location.lat AS DECIMAL)', expect: '35.75' },
    { name: 'a comparison on attachment.size', ...base, expr: 'CAST(.attachment.size AS INTEGER) < 5000000', expect: true },
    { name: 'attachment.size as an integer', ...base, expr: 'CAST(.attachment.size AS INTEGER)', expect: 120000 },
    { name: 'address.text as text', ...base, expr: 'CAST(.address.text AS TEXT) == "Tehran, Valiasr"', expect: true },
    { name: 'address.text as citext', ...base, expr: 'CAST(.address.text AS CITEXT) == "tehran, valiasr"', expect: true },
    { name: 'a count of timeTracking.sessions', ...base, expr: 'COUNT(.tracking.sessions)', expect: 2 },
    { name: 'a test on a count of timeTracking.sessions', ...base, expr: 'COUNT(.tracking.sessions) > 0', expect: true },
    { name: 'a kind test on timeTracking.sessions', ...base, expr: '.tracking.sessions is array', expect: true },

    // The other shapes of notes §6.1.
    { name: 'icon.name as text', ...base, expr: 'CAST(.icon.name AS TEXT)', expect: 'home' },
    { name: 'icon.fill as an integer', ...base, expr: 'CAST(.icon.fill AS INTEGER)', expect: 1 },
    { name: 'canvas.width as an integer', ...base, expr: 'CAST(.canvas.width AS INTEGER) == 800', expect: true },
    { name: 'canvas strokes are counted', ...base, expr: 'COUNT(.canvas.strokes)', expect: 1 },
    { name: 'a point of a stroke (two positions)', ...base, expr: 'CAST(.canvas.strokes[0].points[1][0] AS INTEGER)', expect: 3 },
    { name: 'the object key of an attachment', ...base, expr: 'CAST(.attachment.objectKey AS TEXT)', expect: 'attachments/ws/ds/a1' },
    { name: 'address.lat as a decimal', ...base, expr: 'CAST(.address.lat AS DECIMAL)', expect: '35.7' },

    // Array elements.
    { name: 'the first session is an object', ...base, expr: '.tracking.sessions[0] is object', expect: true },
    { name: 'a key of an element', ...base, expr: 'CAST(.tracking.sessions[1].userId AS TEXT)', expect: 'usr_2' },
    { name: 'a boolean key of an element', ...base, expr: 'CAST(.tracking.sessions[0].manual AS BOOLEAN)', expect: true },
    { name: 'an element after the end is null', ...base, expr: '.tracking.sessions[5] is null', expect: true },
    { name: 'a key missing in one element is null', ...base, expr: '.tracking.sessions[1].end is null', expect: true },
    { name: 'a key present in another element', ...base, expr: '.tracking.sessions[0].end isnot null', expect: true },

    // A key as text.
    { name: 'a key as a text literal', ...base, expr: 'CAST(.attachment["name"] AS TEXT)', expect: 'plan.pdf' },
    { name: 'a key with a space', ...base, expr: 'CAST(.attachment["file name"] AS TEXT)', expect: 'plan 1' },
    { name: 'a key of a key as text', ...base, expr: 'CAST(.canvas["width"] AS INTEGER)', expect: 800 },
    { name: 'a key from a text expression', ...base, expr: 'CAST(.attachment["na" + "me"] AS TEXT)', expect: 'plan.pdf' },

    // The null rule.
    { name: 'a missing key is null', ...base, expr: '.location.altitude is null', expect: true },
    { name: 'a missing key casts to null', ...base, expr: 'CAST(.location.altitude AS DECIMAL)', expect: null },
    { name: 'a missing key compared is false', ...base, expr: 'CAST(.location.altitude AS DECIMAL) > 1', expect: false },
    { name: 'a JSON null value is null', ...base, expr: '.location.address is null', expect: true },
    { name: 'a JSON null value casts to null', ...base, expr: 'CAST(.location.address AS TEXT)', expect: null },
    { name: 'a key of a missing key is null', ...base, expr: '.location.altitude.value is null', expect: true },
    { name: 'a key of a number is null', ...base, expr: '.location.lat.x is null', expect: true },
    { name: 'a key of a string is null', ...base, expr: '.icon.name.x is null', expect: true },
    { name: 'a key of an array is null', ...base, expr: '.tracking.sessions.id is null', expect: true },
    { name: 'a key of a null column is null', schema, record: { id: 2, label: 'x' }, expr: '.icon.name is null', expect: true },
    { name: 'a text key of a null column is null', schema, record: { id: 2, label: 'x' }, expr: '.icon["name"] is null', expect: true },
    { name: 'a position of a null column is null', schema, record: { id: 2, label: 'x' }, expr: '.tracking.sessions[0] is null', expect: true },
    { name: 'a position of a number is null', ...base, expr: '.location.lat[0] is null', expect: true },
    { name: 'a text key of an array is null', ...base, expr: '.tracking.sessions["id"] is null', expect: true },

    // Kind tests of a key.
    { name: 'a number key is a number', ...base, expr: '.location.lat is number', expect: true },
    { name: 'a text key is a string', ...base, expr: '.address.text is string', expect: true },
    { name: 'a key that is a JSON null is not an object', ...base, expr: '.address.parts is object', expect: false },

    // COUNT of a value that is not an array is 0.
    { name: 'a count of an object is 0', ...base, expr: 'COUNT(.location)', expect: 0 },
    { name: 'a count of a missing key is 0', ...base, expr: 'COUNT(.tracking.nothing)', expect: 0 },
    { name: 'a count of a null column is 0', schema, record: { id: 2, label: 'x' }, expr: 'COUNT(.tracking.sessions)', expect: 0 },
    { name: 'a count of a number is 0', ...base, expr: 'COUNT(.location.lat)', expect: 0 },

    // A cast that cannot work.
    { name: 'a text key cast to an integer', ...base, expr: 'CAST(.attachment.name AS INTEGER)', expect: { error: 'cast-failed' } },
    { name: 'a number key cast to a boolean', ...base, expr: 'CAST(.location.lat AS BOOLEAN)', expect: { error: 'cast-failed' } },
    { name: 'a number key cast to text', ...base, expr: 'CAST(.attachment.size AS TEXT)', expect: { error: 'cast-failed' } },
    { name: 'an object cast to text', ...base, expr: 'CAST(.location AS TEXT)', expect: { error: 'cast-failed' } },
    { name: 'an array cast to an integer', ...base, expr: 'CAST(.canvas.strokes AS INTEGER)', expect: { error: 'cast-failed' } },
    { name: 'a text key never casts to a date', ...base, expr: 'CAST(.tracking.sessions[0].start AS DATETIME)', expect: { error: 'cast-failed' } },
    {
        name: 'a text key goes to a date through TEXT',
        ...base,
        expr: 'CAST(CAST(.tracking.sessions[0].start AS TEXT) AS DATETIME) < CAST("2026-10-02" AS DATETIME)',
        expect: true
    },
    { name: 'a missing key casts to a date as null', ...base, expr: 'CAST(.location.altitude AS DATE)', expect: null },
    { name: 'an object key cast to a decimal', ...base, expr: 'CAST(.canvas.strokes[0] AS DECIMAL)', expect: { error: 'cast-failed' } }
];
