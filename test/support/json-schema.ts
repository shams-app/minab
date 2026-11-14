/**
 * A small JSON Schema (draft 2020-12) checker for the tests: it knows the keywords the generated schemas use and throws
 * on any other, so a schema that grows a new keyword fails loudly instead of passing unchecked.
 */

type Schema = Record<string, unknown>;

const ANNOTATIONS = new Set(['$schema', '$id', '$defs', 'title', 'description', 'default', 'examples']);
const KEYWORDS = new Set([
    '$ref',
    'type',
    'const',
    'enum',
    'anyOf',
    'oneOf',
    'properties',
    'required',
    'additionalProperties',
    'items',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'pattern',
    'propertyNames'
]);

const typeOf = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value);

/** The paths at which `value` breaks `schema` (empty when it is valid). */
export function jsonSchemaErrors(root: Schema, value: unknown): string[] {
    const errors: string[] = [];
    const check = (schema: Schema, item: unknown, path: string): boolean => {
        const before = errors.length;
        for (const key of Object.keys(schema)) {
            if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) {
                throw new Error(`Unsupported keyword "${key}" at ${path}`);
            }
        }
        const fail = (message: string) => errors.push(`${path}: ${message}`);
        if (typeof schema.$ref === 'string') {
            const name = schema.$ref.replace('#/$defs/', '');
            const target = (root.$defs as Record<string, Schema>)[name];
            if (!target) {
                throw new Error(`Unknown $ref ${schema.$ref}`);
            }
            check(target, item, path);
        }
        const type = schema.type as string | undefined;
        if (type && !(typeOf(item) === type || (type === 'number' && typeOf(item) === 'integer'))) {
            fail(`not ${type}`);
            return false;
        }
        if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(item)) {
            fail(`not ${JSON.stringify(schema.const)}`);
        }
        if (Array.isArray(schema.enum) && !schema.enum.some(option => JSON.stringify(option) === JSON.stringify(item))) {
            fail('not one of the enum');
        }
        for (const key of ['anyOf', 'oneOf'] as const) {
            const options = schema[key] as Schema[] | undefined;
            if (options) {
                const passing = options.filter(option => {
                    const mark = errors.length;
                    const ok = check(option, item, path) && errors.length === mark;
                    errors.length = mark;
                    return ok;
                }).length;
                if (key === 'anyOf' ? passing === 0 : passing !== 1) {
                    fail(`${key}: ${passing} branches match`);
                }
            }
        }
        if (typeof item === 'string') {
            const length = [...item].length;
            if (typeof schema.minLength === 'number' && length < schema.minLength) fail('too short');
            if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail('too long');
            if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(item)) fail('pattern');
        }
        if (Array.isArray(item)) {
            if (typeof schema.minItems === 'number' && item.length < schema.minItems) fail('too few items');
            if (typeof schema.maxItems === 'number' && item.length > schema.maxItems) fail('too many items');
            if (schema.items) item.forEach((entry, index) => check(schema.items as Schema, entry, `${path}/${index}`));
        }
        if (typeOf(item) === 'object') {
            const object = item as Record<string, unknown>;
            const properties = (schema.properties ?? {}) as Record<string, Schema>;
            for (const key of (schema.required ?? []) as string[]) {
                if (!(key in object)) fail(`missing ${key}`);
            }
            for (const [key, entry] of Object.entries(object)) {
                if (properties[key]) {
                    check(properties[key], entry, `${path}/${key}`);
                } else if (schema.additionalProperties === false) {
                    fail(`unknown property ${key}`);
                } else if (typeof schema.additionalProperties === 'object') {
                    check(schema.additionalProperties as Schema, entry, `${path}/${key}`);
                }
            }
        }
        return errors.length === before;
    };
    check(root, value, '');
    return errors;
}
