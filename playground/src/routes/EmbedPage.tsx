import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { exampleById } from '../content/examples/index.js';
import { useThemeSync } from '../hooks/useTheme.js';
import { useHost } from '../hooks/useHost.js';
import { useWorkbench } from '../hooks/useWorkbench.js';
import { LazyCodeEditor } from '../monaco/LazyCodeEditor.js';
import { openExample, openWorkspace, setAutoRun, setTheme } from '../state/controller.js';
import { decodeShare, shareFromHash } from '../state/share.js';
import { EmbedFrame } from '../ui/embed/EmbedFrame.js';
import { ExecutionView } from '../ui/output/ExecutionView.js';
import { OutputPanel } from '../ui/output/OutputPanel.js';
import { ProblemsList } from '../ui/output/ProblemsList.js';
import { ResultView } from '../ui/output/ResultView.js';
import { SqlView } from '../ui/output/SqlView.js';
import { EmptyState } from '../ui/primitives/primitives.js';
import { RunButton } from '../ui/workbench/Toolbar.js';
import type { OutputTab } from '../state/store.js';

/**
 * /embed — a compact, chrome-free workbench for an <iframe> on another
 * site (a portfolio page, a blog post).
 *
 *   /embed?example=booking-overlap&theme=dark&tabs=result,sql&autorun=0&readonly=1
 *   /embed#s=<share payload>
 *
 * It reports its content height to the parent page as
 * `{ type: 'minab:resize', height }` so the host can size the iframe.
 */
export function EmbedPage() {
    useThemeSync();
    const [params] = useSearchParams();
    const location = useLocation();
    const wb = useWorkbench();
    const host = useHost();
    const root = useRef<HTMLDivElement>(null);

    const tabs = (params.get('tabs')?.split(',').filter(Boolean) as OutputTab[] | undefined) ?? ['result', 'sql', 'execution', 'problems'];
    const readOnly = params.get('readonly') === '1';
    const exampleId = params.get('example');

    useEffect(() => {
        const theme = params.get('theme');
        if (theme === 'light' || theme === 'dark') setTheme(theme);
        if (params.get('autorun') === '0') setAutoRun(false);
        const shared = shareFromHash(location.hash);
        const decoded = shared ? decodeShare(shared) : undefined;
        if (decoded?.ok) openWorkspace('embed', decoded.workspace, { outputTab: tabs[0] });
        else {
            const example = exampleById(exampleId ?? '') ?? exampleById('first-query')!;
            openExample(example, 'embed');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!root.current || window.parent === window) return;
        const observer = new ResizeObserver(() => {
            window.parent.postMessage({ type: 'minab:resize', height: root.current!.scrollHeight }, '*');
        });
        observer.observe(root.current);
        return () => observer.disconnect();
    }, []);

    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const openHref = `${base}/play${wb.example ? `?example=${wb.example.id}` : ''}`;
    const tab = tabs.includes(wb.outputTab) ? wb.outputTab : tabs[0];

    return (
        <div ref={root} className="mb-embed-root">
            <EmbedFrame
                title={wb.example?.title}
                openHref={openHref}
                runButton={<RunButton onRun={wb.run} running={wb.running} />}
                editor={
                    <LazyCodeEditor
                        path="embed/main.minab"
                        value={wb.source}
                        onChange={wb.setSource}
                        readOnly={readOnly}
                        compact
                        ariaLabel="Minab program"
                        diagnostics={wb.diagnostics}
                        pushdowns={wb.stale ? undefined : wb.report?.trace}
                        highlight={wb.highlight}
                        onRun={wb.run}
                    />
                }
                output={
                    <OutputPanel
                        tab={tab}
                        onTabChange={wb.setOutputTab}
                        tabs={tabs}
                        counts={{ problems: wb.problems.errors, statements: wb.report?.trace.length }}
                    >
                        {tab === 'result' ? (
                            <ResultView
                                report={wb.report}
                                running={wb.running}
                                stale={wb.stale}
                                subject={{ recordTable: host.recordTable, fieldValue: host.fieldValue }}
                                onRun={wb.run}
                                onShowProblems={() => wb.setOutputTab('problems')}
                                onShowExecution={() => wb.setOutputTab('execution')}
                            />
                        ) : tab === 'sql' ? (
                            <SqlView analysis={wb.analysis} trace={wb.report?.trace ?? []} onShowExecution={() => wb.setOutputTab('execution')} />
                        ) : tab === 'execution' ? (
                            <ExecutionView report={wb.report} onHighlight={r => wb.setHighlight(r)} onReveal={wb.revealInEditor} />
                        ) : tab === 'problems' ? (
                            <ProblemsList diagnostics={wb.diagnostics} onSelect={wb.revealInEditor} />
                        ) : (
                            <EmptyState title="Not available in embeds" />
                        )}
                    </OutputPanel>
                }
            />
        </div>
    );
}
