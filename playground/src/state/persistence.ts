/**
 * Per-browser conveniences in localStorage: the scratch workspace, tour
 * progress, UI preferences. Storage can be missing or throw (private
 * windows, blocked site data, previews), so every access is guarded and
 * the app works the same without it — it just forgets.
 */

const PREFIX = 'minab-playground:';

export function load<T>(key: string): T | undefined {
    try {
        const raw = globalThis.localStorage?.getItem(PREFIX + key);
        return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
        return undefined;
    }
}

export function save(key: string, value: unknown): void {
    try {
        globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        // Quota exceeded or storage blocked: the setting simply isn't remembered.
    }
}

export function remove(key: string): void {
    try {
        globalThis.localStorage?.removeItem(PREFIX + key);
    } catch {
        // Nothing to do.
    }
}
