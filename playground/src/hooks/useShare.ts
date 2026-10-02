import { strToU8, zipSync } from 'fflate';
import { engineClient } from '../client/engine-client.js';
import { toast } from '../state/controller.js';
import { getState } from '../state/store.js';
import { shareUrl } from '../state/share.js';
import { cliConfig } from '../state/workspace.js';

export interface ShareView {
    /** Copies a link that reopens this exact program and host. */
    copyLink: () => Promise<void>;
    /** Copies an `<iframe>` snippet for a blog post or portfolio page. */
    copyEmbed: () => Promise<void>;
    /** Downloads program + config + seed.sql, ready for the `minab` CLI and a real Postgres. */
    exportBundle: () => Promise<void>;
    linkFor: (page: '/play' | '/embed') => string;
}

async function copy(text: string, done: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        toast(done, 'success');
    } catch {
        window.prompt('Copy this:', text);
    }
}

function base(): string {
    return import.meta.env.BASE_URL;
}

export function useShare(): ShareView {
    const linkFor = (page: '/play' | '/embed') => shareUrl(getState().workspace, page, window.location.origin, base());
    return {
        linkFor,
        copyLink: () => copy(linkFor('/play'), 'Link copied — it opens this program exactly as it is now.'),
        copyEmbed: () =>
            copy(
                `<iframe src="${linkFor('/embed')}" title="Minab example" style="width:100%;height:420px;border:0;border-radius:12px" loading="lazy"></iframe>`,
                'Embed code copied.'
            ),
        exportBundle: async () => {
            const { workspace } = getState();
            const name = workspace.exampleId ?? 'program';
            const seed = await engineClient().call('seedSql');
            const readme = [
                `# ${name}`,
                '',
                'Exported from the Minab playground.',
                '',
                '```bash',
                '# check and compile — no database needed',
                `minab check ${name}.minab`,
                `minab compile ${name}.minab`,
                '',
                '# run against PostgreSQL, with the same data the playground used',
                'createdb minab_demo && psql minab_demo < seed.sql',
                `minab run ${name}.minab --database postgresql://localhost/minab_demo`,
                '```',
                '',
                'Install the CLI from https://github.com/shams-app/minab (see its README).',
                ''
            ].join('\n');
            const zip = zipSync({
                [`${name}/${name}.minab`]: strToU8(workspace.source),
                [`${name}/minab.config.json`]: strToU8(JSON.stringify(cliConfig(workspace.host), null, 2) + '\n'),
                [`${name}/seed.sql`]: strToU8(seed),
                [`${name}/README.md`]: strToU8(readme)
            });
            const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name}.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast(`Downloaded ${name}.zip — program, config and seed.sql for the CLI.`, 'success');
        }
    };
}
