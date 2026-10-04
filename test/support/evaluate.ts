import type { Model } from '../../src/language/generated/ast.js';
import type { EvalContext, EvalResult, MinabInterpreter } from '../../src/language/minab-interpreter.js';

/**
 * Runs a program with `interpreter.run` and gives the answer in the short shape many
 * interpreter tests use: `{ ok: true, value }`, or `{ ok: false, reason, code?, params? }`.
 * A failure of the data port is thrown again. There are no limits.
 */
export async function evaluate(interpreter: MinabInterpreter, model: Model, context: EvalContext): Promise<EvalResult> {
    const result = await interpreter.run(model, context);
    if (result.ok) return result;
    if (result.cause !== undefined) throw result.cause;
    const { error } = result;
    // A plain failure has no code in this shape.
    if (error.code === 'eval.failed') return { ok: false, reason: error.message };
    return { ok: false, reason: error.message, code: error.code, params: error.params };
}
