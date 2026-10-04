import { Link } from 'react-router';
import type { Lesson } from '../../content/types.js';
import type { LessonSummary } from '../../hooks/useTour.js';
import { Inline, Markdown } from '../primitives/Code.js';
import { Button, Callout } from '../primitives/primitives.js';
import { Icon } from '../primitives/Icon.js';
import { Mark } from '../primitives/Mark.js';

/** Link labels are read aloud, so drop the backticks of inline code. */
const plain = (title: string) => title.replace(/`/g, '');

const SIGILS = [
    { glyph: '.', token: 'sigil-record' },
    { glyph: '$', token: 'sigil-field' },
    { glyph: '^', token: 'sigil-parent' },
    { glyph: '#', token: 'sigil-alias' }
];

export function LessonList({ lessons, progress }: { lessons: LessonSummary[]; progress: { done: number; total: number } }) {
    return (
        <nav className="mb-lesson-list" aria-label="Lessons">
            <p className="mb-lesson-eyebrow">
                <span className="mb-label">Tour</span>
                <span className="mb-mono">
                    {progress.done}/{progress.total} done
                </span>
            </p>
            <div
                className="mb-progress"
                role="progressbar"
                aria-label="Tour progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
            >
                <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <ol>
                {lessons.map(l => (
                    <li key={l.id} data-state={l.current ? 'current' : l.completed ? 'done' : undefined}>
                        <Link
                            to={`/learn/${l.id}`}
                            aria-current={l.current ? 'step' : undefined}
                            aria-label={`Lesson ${l.number}: ${plain(l.title)}${l.completed ? ', done' : ''}`}
                        >
                            <span className="mb-lesson-mark" aria-hidden="true">
                                {l.completed ? <Icon name="check" size={12} /> : l.number}
                            </span>
                            <span>
                                <Inline text={l.title} />
                            </span>
                        </Link>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

export interface LessonPanelProps {
    lesson: Lesson;
    goalMet: boolean;
    completed: boolean;
    hintsShown: number;
    onHint: () => void;
    solutionShown: boolean;
    onSolution: () => void;
    onReset: () => void;
    next?: LessonSummary;
    previous?: LessonSummary;
}

export function LessonPanel({ lesson, goalMet, completed, hintsShown, onHint, solutionShown, onSolution, onReset, next, previous }: LessonPanelProps) {
    return (
        <article className="mb-lesson">
            <header>
                <p className="mb-lesson-number">Lesson {lesson.number}</p>
                <h1>
                    <Inline text={lesson.title} />
                </h1>
            </header>
            <Markdown source={lesson.body} />
            <div className="mb-goal" data-state={goalMet ? 'met' : 'open'} role="status" aria-live="polite">
                {goalMet && (
                    <span className="mb-celebrate" aria-hidden="true">
                        {SIGILS.map(({ glyph, token }) => (
                            <span key={glyph} className={`tok tok-${token}`}>
                                {glyph}
                            </span>
                        ))}
                    </span>
                )}
                {goalMet ? (
                    <span className="mb-goal-disc" aria-hidden="true">
                        <Icon name="check" size={14} />
                    </span>
                ) : (
                    <Icon name="flag" />
                )}
                <div>
                    <p className="mb-goal-title">{goalMet ? 'Goal met — nicely done.' : 'Goal'}</p>
                    <p>
                        <Inline text={lesson.task} />
                    </p>
                </div>
            </div>
            {goalMet && !next && (
                <div className="mb-tour-complete" role="status">
                    <Mark size={64} className="mb-mark-draw" />
                    <p className="mb-tour-complete-title">Tour complete</p>
                    <p className="mb-muted">You have seen the whole language. The examples are the next step.</p>
                </div>
            )}
            {lesson.hints.slice(0, hintsShown).map((hint, i) => (
                <Callout key={i} tone="warning" icon="lightbulb" title={`Hint ${i + 1}.`}>
                    <Markdown source={hint} />
                </Callout>
            ))}
            <div className="mb-row mb-lesson-actions">
                {hintsShown < lesson.hints.length && !goalMet && (
                    <Button size="sm" variant="secondary" icon="lightbulb" onClick={onHint}>
                        {hintsShown ? 'Another hint' : 'Hint'}
                    </Button>
                )}
                {!solutionShown && !goalMet && (
                    <Button size="sm" variant="ghost" icon="eye" onClick={onSolution}>
                        Show solution
                    </Button>
                )}
                <Button size="sm" variant="ghost" icon="reset" onClick={onReset}>
                    Start over
                </Button>
            </div>
            <footer className="mb-lesson-nav">
                {previous ? (
                    <Link className="mb-button" data-variant="ghost" to={`/learn/${previous.id}`} aria-label={`Previous lesson: ${plain(previous.title)}`}>
                        <Icon name="chevron-left" /> previous
                    </Link>
                ) : (
                    <span />
                )}
                {next ? (
                    <Link
                        className="mb-button"
                        data-variant={goalMet || completed ? 'primary' : 'secondary'}
                        to={`/learn/${next.id}`}
                        aria-label={`Next lesson: ${plain(next.title)}`}
                    >
                        next <Icon name="chevron-right" />
                    </Link>
                ) : (
                    <Link className="mb-button" data-variant="primary" to="/examples">
                        Explore the examples <Icon name="chevron-right" />
                    </Link>
                )}
            </footer>
        </article>
    );
}
