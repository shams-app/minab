import type { DifferentialCase } from '../harness.js';

/** L3: names in any language, backtick names and `sqlName`. Both runtimes must agree. */

const UNICODE = {
    tables: [
        {
            name: 'سفارش',
            primaryKey: 'شناسه',
            columns: { شناسه: 'INTEGER', مبلغ: 'INTEGER', تخفیف: 'INTEGER', وضعیت: 'TEXT', İl: 'TEXT', 'Order date': 'DATE?', 'a`b': 'INTEGER?' }
        }
    ]
};

const PHYSICAL = {
    tables: [
        {
            name: 'Order',
            sqlName: 'tbl_order',
            primaryKey: 'id',
            columns: {
                id: { type: 'INTEGER', sqlName: 'fld_id' },
                نام: { type: 'TEXT', sqlName: 'fld_ab12' },
                amount: { type: 'INTEGER', sqlName: 'fld"q' }
            }
        }
    ]
};

export const cases: DifferentialCase[] = [
    { name: 'persian columns in arithmetic', schema: UNICODE, record: { شناسه: 1, مبلغ: 100, تخفیف: 30 }, expr: '.مبلغ - .تخفیف', expect: 70 },
    { name: 'persian text compare', schema: UNICODE, record: { شناسه: 1, وضعیت: 'ارسال‌شده' }, expr: '.وضعیت == "ارسال‌شده"', expect: true },
    { name: 'turkish column name', schema: UNICODE, record: { شناسه: 1, İl: 'İzmir' }, expr: '.İl == "İzmir"', expect: true },
    {
        name: 'backtick name with a space',
        schema: UNICODE,
        record: { شناسه: 1, 'Order date': '2026-01-01' },
        expr: '.`Order date` == CAST("2026-01-01" AS DATE)',
        expect: true
    },
    { name: 'backtick name with an escaped backtick', schema: UNICODE, record: { شناسه: 1, 'a`b': 4 }, expr: '.`a\\`b` * 2', expect: 8 },
    { name: 'sqlName on a column', schema: PHYSICAL, record: { id: 1, نام: 'Ada', amount: 5 }, expr: '.نام == "Ada"', expect: true },
    { name: 'sqlName with a double quote', schema: PHYSICAL, record: { id: 1, نام: 'Ada', amount: 5 }, expr: '.amount + 1', expect: 6 }
];
