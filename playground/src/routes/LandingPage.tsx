import { useEffect, useState } from 'react';
import { usePlayground } from '../state/store.js';
import { exampleById } from '../content/examples/index.js';
import { landing } from '../content/landing.js';
import { useSnippet } from '../hooks/useSnippet.js';
import { preloadEditor } from '../monaco/LazyCodeEditor.js';
import { warmUpEngine } from '../state/controller.js';
import { prettySql } from '../syntax/highlight.js';
import { Comparison, CtaBand, DemoLoading, FeatureGrid, Footer, Hero, HeroDemo, HowItRuns, LayerCards, NameBand, SigilGrid } from '../ui/landing/Landing.js';
import { RowsTable, VerdictCard } from '../ui/output/ResultView.js';
import { CodeBlock } from '../ui/primitives/Code.js';
import { Callout } from '../ui/primitives/primitives.js';
import type { RunReport } from '../engine/protocol.js';

/** The wording is approved in round 1 of the design (handoff.md, "Copy decided in round 1"). */
const NAME_LINE = 'Named for Minab, a city in southern Iran — in memory of the 168 children and their teachers who were killed when their school was bombed.';

/** Phones open on the Rule tab: the verdict is the clearest result on a small screen. */
function firstDemo(): string {
    const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
    return (phone ? landing.demo.find(d => d.label === 'Rule') : undefined)?.exampleId ?? landing.demo[0].exampleId;
}

function DemoOutput({ report, loading }: { report?: RunReport; loading: boolean }) {
    if (loading || !report) return <DemoLoading />;
    if (report.stage === 'check' || report.stage === 'parse') {
        const d = report.diagnostics.find(x => x.severity === 1) ?? report.diagnostics[0];
        return (
            <>
                {d && (
                    <Callout tone="danger" icon="alert" title={d.message}>
                        <p className="mb-mono mb-muted">
                            {d.code ? `${d.code} · ` : ''}line {d.range.start.line + 1}, col {d.range.start.character + 1}
                        </p>
                    </Callout>
                )}
                <p className="mb-muted">Nothing was sent to the database.</p>
            </>
        );
    }
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
                {report.trace[0] && (
                    <CodeBlock code={prettySql(report.trace[0].text)} language="sql" caption="⇣ The one statement that reached Postgres" wrap />
                )}
            </>
        );
    }
    return null;
}

/** "5 rows · 1 statement · 3.4 ms" */
function demoMeta(report?: RunReport): string {
    if (!report || report.stage === 'check' || report.stage === 'parse') return '';
    const parts: string[] = [];
    if (report.result?.kind === 'rows') parts.push(`${report.result.rows.length} ${report.result.rows.length === 1 ? 'row' : 'rows'}`);
    parts.push(`${report.trace.length} ${report.trace.length === 1 ? 'statement' : 'statements'}`);
    parts.push(`${report.totalMs.toFixed(1)} ms`);
    return parts.join(' · ');
}

export function LandingPage() {
    const [active, setActive] = useState<string>(firstDemo);
    const engine = usePlayground(st => st.engine);
    const demo = useSnippet(active);
    const comparison = useSnippet(landing.comparison.exampleId);
    const rule = useSnippet(landing.layers.rule.exampleId);
    const current = landing.demo.find(d => d.exampleId === active)!;

    // Monaco loads only after first paint and a quiet moment, so it never competes with the hero. The hero demo
    // itself starts the worker and the database; warming the engine here just makes "Open the playground" instant.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            warmUpEngine();
            preloadEditor();
        }, 2000);
        return () => window.clearTimeout(timer);
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
                        tabs={landing.demo.map(d => ({
                            id: d.exampleId,
                            label: d.label
                        }))}
                        active={active}
                        onSelect={setActive}
                        caption={current.caption}
                        source={demo.example?.source ?? ''}
                        output={<DemoOutput report={demo.report} loading={demo.loading} />}
                        openHref={`/play?example=${active}`}
                        database={engine.phase === 'ready' && engine.database === 'ready' ? 'ready' : 'starting'}
                        meta={demo.loading ? '' : demoMeta(demo.report)}
                    />
                }
            />
            <LayerCards
                title={landing.layers.title}
                body={landing.layers.body}
                cards={[
                    {
                        title: landing.layers.query.title,
                        badge: 'pipeline',
                        body: landing.layers.query.body,
                        source: layerQuery.source,
                        href: `/play?example=${layerQuery.id}`
                    },
                    {
                        title: landing.layers.rule.title,
                        badge: 'record rule',
                        body: landing.layers.rule.body,
                        source: layerRule.source,
                        href: `/play?example=${layerRule.id}`
                    }
                ]}
            />
            <SigilGrid title={landing.sigils.title} body={landing.sigils.body} items={landing.sigils.items} />
            <HowItRuns
                title={landing.pipeline.title}
                steps={landing.pipeline.steps}
                diagram={{
                    rule: layerRule.source,
                    sql: rule.report?.trace[0] ? prettySql(rule.report.trace[0].text) : undefined,
                    verdict: rule.report?.result?.kind === 'verdict' ? (rule.report.result.value ? 'The rule Passes ✓' : 'The rule Fails ✕') : undefined
                }}
            />
            <Comparison
                title={landing.comparison.title}
                body={landing.comparison.body}
                minab={comparisonExample.source}
                sql={comparison.report?.compiled.ok ? prettySql(comparison.report.compiled.formatted) : undefined}
                href={`/play?example=${comparisonExample.id}`}
            />
            <FeatureGrid features={landing.features} />
            <CtaBand title={landing.cta.title} body={landing.cta.body} primary={landing.cta.primary} secondary={landing.cta.secondary} />
            <NameBand text={NAME_LINE} />
            <Footer author={landing.footer.author} authorUrl={landing.footer.authorUrl} links={landing.footer.links} note={landing.footer.note} />
        </div>
    );
}
