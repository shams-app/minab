import type { ReactNode } from 'react';
import { Wordmark } from '../shell/AppShell.js';

export interface EmbedFrameProps {
    title?: string;
    editor: ReactNode;
    output: ReactNode;
    runButton: ReactNode;
    openHref: string;
}

/** The compact frame shown in an <iframe> on other sites: editor, result, and a way into the full playground. */
export function EmbedFrame({ title, editor, output, runButton, openHref }: EmbedFrameProps) {
    return (
        <div className="mb-embed">
            <header className="mb-embed-head">
                <a href={openHref} target="_blank" rel="noreferrer" className="mb-embed-brand">
                    <Wordmark />
                </a>
                {title && <span className="mb-embed-title">{title}</span>}
                <div className="mb-row">
                    {runButton}
                    <a className="mb-button" data-variant="ghost" data-size="sm" href={openHref} target="_blank" rel="noreferrer">
                        Open in playground ↗
                    </a>
                </div>
            </header>
            <div className="mb-embed-body">
                <div className="mb-embed-editor">{editor}</div>
                <div className="mb-embed-output">{output}</div>
            </div>
        </div>
    );
}
