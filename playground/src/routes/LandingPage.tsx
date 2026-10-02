import { useEffect, useState } from 'react';
import { exampleById } from '../content/examples/index.js';
import { landing } from '../content/landing.js';
import { useSnippet } from '../hooks/useSnippet.js';
import { preloadEditor } from '../monaco/LazyCodeEditor.js';
import { warmUpEngine } from '../state/controller.js';
import { prettySql } from '../syntax/highlight.js';
import { Comparison, CtaBand, FeatureGrid, Footer, Hero, HeroDemo, HowItRuns, LayerCards, SigilGrid } from '../ui/landing/Landing.js';
import { RowsTable, VerdictCard } from '../ui/output/ResultView.js';
import { ProblemsList } from '../ui/output/ProblemsList.js';
import { CodeBlock } from '../ui/primitives/Code.js';
import { EmptyState, Spinner } from '../ui/primitives/primitives.js';
import type { RunReport } from '../engine/protocol.js';

function DemoOutput({ report, loading }: { report?: RunReport; loading: boolean }) {
    if (loading || !report)
        return (
            <EmptyState icon="database" title="Starting PostgreSQL in your browser…">
                <Spinner />
            </EmptyState>
        );
    if (report.stage === 'check') return <ProblemsList diagnostics={report.diagnostics} onSelect={() => undefined} />;
    if (report.result?.kind === 'rows') {
        return (
            <>
                {report.compiled.ok && <CodeBlock code={prettySql(report.compiled.text)} language="sql" caption="Compiled to" wrap />}
                <RowsTable columns={report.result.columns} rows={report.result.rows.slice(0, 5)} />
            </>
        );
    }
    if (report.result?.kind === 'verdict') {
        return (
            <>
                <VerdictCard
                    value={report.result.value}
                    kind={report.program.kind}
                    subject={{ recordTable: 'Booking' }}
                    statements={report.trace.length}
                    onShowExecution={() => undefined}
                />
                {report.trace[0] && <CodeBlock code={prettySql(report.trace[0].text)} language="sql" caption="The one statement that reached Postgres" wrap />}
            </>
        );
    }
    return null;
}

export function LandingPage() {
    const [active, setActive] = useState<string>(landing.demo[0].exampleId);
    const demo = useSnippet(active);
    const comparison = useSnippet(landing.comparison.exampleId);
    const current = landing.demo.find(d => d.exampleId === active)!;

    // Warm up the engine and the editor while the visitor reads, so "Open the playground" is instant.
    useEffect(() => {
        const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
        idle(() => {
            warmUpEngine();
            preloadEditor();
        });
    }, []);

    const layerQuery = exampleById(landing.layers.query.exampleId)!;
    const layerRule = exampleById(landing.layers.rule.exampleId)!;
    const comparisonExample = exampleById(landing.comparison.exampleId)!;

    return (
        <div className="mb-landing">
            <Hero
                eyebrow={landing.eyebrow}
                headline={landing.headline}
                subhead={landing.subhead}
                primary={landing.primaryCta}
                secondary={landing.secondaryCta}
                note={landing.runsHere}
                demo={
                    <HeroDemo
                        tabs={landing.demo.map(d => ({ id: d.exampleId, label: d.label }))}
                        active={active}
                        onSelect={setActive}
                        caption={current.caption}
                        source={demo.example?.source ?? ''}
                        output={<DemoOutput report={demo.report} loading={demo.loading} />}
                        openHref={`/play?example=${active}`}
                    />
                }
            />
            <LayerCards
                title={landing.layers.title}
                body={landing.layers.body}
                cards={[
                    { title: landing.layers.query.title, body: landing.layers.query.body, source: layerQuery.source, href: `/play?example=${layerQuery.id}` },
                    { title: landing.layers.rule.title, body: landing.layers.rule.body, source: layerRule.source, href: `/play?example=${layerRule.id}` }
                ]}
            />
            <SigilGrid title={landing.sigils.title} body={landing.sigils.body} items={landing.sigils.items} />
            <HowItRuns title={landing.pipeline.title} steps={landing.pipeline.steps} />
            <Comparison
                title={landing.comparison.title}
                body={landing.comparison.body}
                minab={comparisonExample.source}
                sql={comparison.report?.compiled.ok ? prettySql(comparison.report.compiled.formatted) : undefined}
                href={`/play?example=${comparisonExample.id}`}
            />
            <FeatureGrid features={landing.features} />
            <CtaBand title={landing.cta.title} body={landing.cta.body} primary={landing.cta.primary} secondary={landing.cta.secondary} />
            <Footer author={landing.footer.author} authorUrl={landing.footer.authorUrl} links={landing.footer.links} note={landing.footer.note} />
        </div>
    );
}
