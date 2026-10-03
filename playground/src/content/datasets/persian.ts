/**
 * کتاب‌فروشی — a small Persian bookshop. Table and column names are written
 * in Persian, so programs can show names in any language (spec §2.3). Two
 * tables, a relation between them, and enough rows that a filter, a sort
 * and a total all give an answer worth reading.
 */

import type { Row } from '../../engine/protocol.js';
import type { Dataset } from './types.js';

const schema = {
    tables: [
        {
            name: 'مشتری',
            primaryKey: 'شناسه',
            columns: {
                شناسه: 'INTEGER',
                نام: 'TEXT',
                شهر: 'TEXT',
                سفارش‌ها: { collection: 'سفارش', foreignKey: 'مشتری_شناسه' }
            }
        },
        {
            name: 'سفارش',
            primaryKey: 'شناسه',
            columns: {
                شناسه: 'INTEGER',
                مشتری: { ref: 'مشتری', foreignKey: 'مشتری_شناسه' },
                وضعیت: 'TEXT',
                مبلغ: 'DECIMAL',
                تاریخ: 'DATE'
            }
        }
    ]
};

const customers: Row[] = [
    { شناسه: 1, نام: 'مریم احمدی', شهر: 'تهران' },
    { شناسه: 2, نام: 'علی رضایی', شهر: 'شیراز' },
    { شناسه: 3, نام: 'پریسا کریمی', شهر: 'اصفهان' }
];

const orders: Row[] = [
    { شناسه: 101, مشتری_شناسه: 1, وضعیت: 'ارسال‌شده', مبلغ: 480, تاریخ: '2026-09-02' },
    { شناسه: 102, مشتری_شناسه: 2, وضعیت: 'ارسال‌شده', مبلغ: 1250, تاریخ: '2026-09-05' },
    { شناسه: 103, مشتری_شناسه: 1, وضعیت: 'جدید', مبلغ: 90, تاریخ: '2026-09-11' },
    { شناسه: 104, مشتری_شناسه: 3, وضعیت: 'ارسال‌شده', مبلغ: 760, تاریخ: '2026-09-14' },
    { شناسه: 105, مشتری_شناسه: 2, وضعیت: 'لغو‌شده', مبلغ: 300, تاریخ: '2026-09-20' },
    { شناسه: 106, مشتری_شناسه: 3, وضعیت: 'جدید', مبلغ: 2100, تاریخ: '2026-09-27' }
];

export const persianDataset: Dataset = {
    id: 'persian',
    title: 'کتاب‌فروشی (Persian names)',
    description: 'A small bookshop whose tables and columns have Persian names: customers and their orders.',
    schema,
    seed: { مشتری: customers, سفارش: orders }
};
