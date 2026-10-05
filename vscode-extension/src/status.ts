import * as path from 'node:path';

/**
 * The status bar text for the config file a document uses.
 * The path is shown relative to the workspace folder when the file is inside it.
 */
export function statusText(configPath: string | null, workspaceFolder?: string): string {
    if (configPath === null) return 'Minab: no config';
    if (workspaceFolder !== undefined) {
        const relative = path.relative(workspaceFolder, configPath);
        if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) return `Minab: ${relative.split(path.sep).join('/')}`;
    }
    return `Minab: ${configPath}`;
}
