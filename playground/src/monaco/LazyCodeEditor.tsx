/**
 * Monaco is the heaviest thing on the site, so it loads on demand. Until
 * it arrives, the program is shown as highlighted static code in the same
 * spot — the page is readable immediately, and interactive a moment later.
 */

import { lazy, Suspense } from 'react';
import { CodeBlock } from '../ui/primitives/Code.js';
import type { CodeEditorProps } from './CodeEditor.js';

const CodeEditor = lazy(() => import('./CodeEditor.js'));

export function LazyCodeEditor(props: CodeEditorProps) {
    return (
        <Suspense fallback={<div className="mb-editor-fallback" aria-busy="true"><CodeBlock code={props.value} language={props.language === 'json' ? 'plain' : 'minab'} /></div>}>
            <CodeEditor {...props} />
        </Suspense>
    );
}

/** Starts downloading Monaco without rendering it — for links the visitor is about to click. */
export function preloadEditor(): void {
    void import('./CodeEditor.js');
}
