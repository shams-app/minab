/**
 * The workbench's arrangement: editor on the left, output on the right,
 * the host panel under the editor. Panels resize on wide screens; below
 * 900px they become three tabs (Code · Result · Host) with Run always in
 * reach.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Tabs } from '../primitives/primitives.js';

export interface WorkbenchLayoutProps {
    toolbar: ReactNode;
    editor: ReactNode;
    statusBar: ReactNode;
    output: ReactNode;
    host?: ReactNode;
    hostOpen: boolean;
    /** Shown above the editor on the tour page. */
    aside?: ReactNode;
    /** Mobile: a Run button pinned to the bottom. */
    runFab: ReactNode;
    /** Result counts for the mobile tab badges. */
    mobileBadges?: { result?: ReactNode };
    /** Shown under the editor while the host panel is collapsed — a way to bring it back. */
    hostCollapsedBar?: ReactNode;
}

/** Narrow by the workbench's own width, not the window's — beside the tour's lesson it has less room. */
function useNarrow(element: RefObject<HTMLElement | null>, breakpoint = 760): boolean {
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint);
    useEffect(() => {
        const node = element.current;
        if (!node) return;
        const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < breakpoint));
        observer.observe(node);
        return () => observer.disconnect();
    }, [element, breakpoint]);
    return narrow;
}

export function WorkbenchLayout({ toolbar, editor, statusBar, output, host, hostOpen, aside, runFab, mobileBadges, hostCollapsedBar }: WorkbenchLayoutProps) {
    const root = useRef<HTMLDivElement>(null);
    const narrow = useNarrow(root);
    const [mobileTab, setMobileTab] = useState<'code' | 'result' | 'host'>('code');

    if (narrow) {
        return (
            <div className="mb-workbench" data-layout="stacked" ref={root}>
                {toolbar}
                {aside}
                <Tabs
                    idPrefix="workbench"
                    ariaLabel="Workbench"
                    active={mobileTab}
                    onChange={setMobileTab}
                    tabs={[
                        { id: 'code', label: 'Code', icon: 'code' },
                        { id: 'result', label: 'Result', icon: 'table', badge: mobileBadges?.result },
                        ...(host ? [{ id: 'host' as const, label: 'Host', icon: 'database' as const }] : [])
                    ]}
                />
                <div className="mb-workbench-mobile-body" id="workbench-panel" role="tabpanel">
                    {mobileTab === 'code' && <div className="mb-editor-frame">{editor}{statusBar}</div>}
                    {mobileTab === 'result' && output}
                    {mobileTab === 'host' && host}
                </div>
                {runFab}
            </div>
        );
    }

    return (
        <div className="mb-workbench" data-layout="split" ref={root}>
            {toolbar}
            <Group orientation="horizontal" className="mb-workbench-panels" id="mb-workbench">
                <Panel defaultSize="55%" minSize="30%" id="left">
                    <Group orientation="vertical" id="mb-workbench-left">
                        <Panel defaultSize={host && hostOpen ? '62%' : '100%'} minSize="25%" id="editor">
                            <div className="mb-editor-frame">
                                {aside}
                                <div className="mb-editor-slot">{editor}</div>
                                {statusBar}
                                {host && !hostOpen && hostCollapsedBar}
                            </div>
                        </Panel>
                        {host && hostOpen && (
                            <>
                                <Separator className="mb-resize-handle" data-orientation="horizontal" />
                                <Panel defaultSize="38%" minSize="15%" id="host">{host}</Panel>
                            </>
                        )}
                    </Group>
                </Panel>
                <Separator className="mb-resize-handle" data-orientation="vertical" />
                <Panel defaultSize="45%" minSize="25%" id="output">{output}</Panel>
            </Group>
        </div>
    );
}
