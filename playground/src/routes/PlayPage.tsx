import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { exampleById } from '../content/examples/index.js';
import { openExample, openWorkspace, toast } from '../state/controller.js';
import { load } from '../state/persistence.js';
import { decodeShare, shareFromHash } from '../state/share.js';
import type { Workspace } from '../state/workspace.js';
import { Workbench } from './Workbench.js';

const DEFAULT_EXAMPLE = 'first-query';

/**
 * /play — the open workbench. What it opens, in order: a share link
 * (`#s=…`), an example (`?example=…`), the visitor's last scratch
 * workspace, or the first example. The URL is then cleaned, so a reload
 * restores the saved workspace rather than resetting to the link.
 */
export function PlayPage() {
    const [params] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const exampleParam = params.get('example');

    useEffect(() => {
        const shared = shareFromHash(location.hash);
        if (shared) {
            const decoded = decodeShare(shared);
            if (decoded.ok) {
                openWorkspace('play', decoded.workspace);
                toast('Opened a shared program.', 'info');
            } else {
                toast(decoded.error, 'error');
                openExample(exampleById(DEFAULT_EXAMPLE)!);
            }
            navigate('/play', { replace: true });
            return;
        }
        if (exampleParam) {
            const example = exampleById(exampleParam);
            if (example) openExample(example);
            else toast(`There is no example called “${exampleParam}”.`, 'error');
            navigate('/play', { replace: true });
            return;
        }
        const saved = load<Workspace>('workspace:play');
        if (saved?.source !== undefined && saved.host) openWorkspace('play', saved);
        else openExample(exampleById(DEFAULT_EXAMPLE)!);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [exampleParam, location.hash]);

    return <Workbench variant="play" editorPath="play/main.minab" />;
}
