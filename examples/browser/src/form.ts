import type { RoutedProgram } from '@shamsine/minab/browser';
import { router } from './minab';

/** A rule that needs no data: the analysis says tier `local`, so it runs in the worker with no network call. */
const LOCAL_RULE = { id: 'end-after-start', version: '1', source: '.end_date > .start_date' };
/** A rule that reads other orders: tier `data`, so it runs on the server. This source is the stored program `order-limit` v1 of the NestJS example. */
const REMOTE_RULE = { id: 'order-limit', version: '1', source: 'COUNT(#Order[.customer == ^.customer AND .status == "open"]) <= 5' };

const text = (id: string, value: string) => {
    document.getElementById(id)!.textContent = value;
};

function show(prefix: 'local' | 'remote', result: Awaited<ReturnType<RoutedProgram['run']>>): void {
    if (result.ok) {
        text(`${prefix}-verdict`, result.value === true ? 'valid' : 'invalid');
        text(`${prefix}-error`, '');
    } else {
        text(`${prefix}-verdict`, 'error');
        text(`${prefix}-error`, result.error.code);
    }
}

export async function startForm(): Promise<void> {
    const form = document.getElementById('order') as HTMLFormElement;
    const [localRule, remoteRule] = await Promise.all([router.prepare(LOCAL_RULE), router.prepare(REMOTE_RULE)]);

    const record = (): Record<string, string> => {
        const data = new FormData(form);
        return { customer: String(data.get('customer')), status: 'open', start_date: String(data.get('start_date')), end_date: String(data.get('end_date')), total: String(data.get('total')) };
    };

    // Every change runs the local rule. No request goes out: the router sees tier `local`.
    const check = async () => {
        const values = record();
        if (!values.start_date || !values.end_date) return text('local-verdict', 'waiting');
        show('local', await localRule.run({ record: values }));
    };
    form.addEventListener('input', () => void check());
    void check();

    // Submit sends the id and the version of the stored rule, with only the fields the rule reads. No SQL, no schema.
    form.addEventListener('submit', event => {
        event.preventDefault();
        const values = record();
        const needed = new Set(remoteRule.analysis.recordFields);
        const sent = Object.fromEntries(Object.entries(values).filter(([name]) => needed.has(name)));
        text('remote-verdict', 'sending');
        void remoteRule.run({ record: sent }).then(result => show('remote', result));
    });
}
