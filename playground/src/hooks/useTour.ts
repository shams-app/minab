import { useEffect, useMemo, useState } from 'react';
import { lessons } from '../content/tour/index.js';
import type { Lesson } from '../content/types.js';
import { markLessonComplete, openLesson, resetTourProgress } from '../state/controller.js';
import { load } from '../state/persistence.js';
import { usePlayground } from '../state/store.js';
import type { Workspace } from '../state/workspace.js';

export interface LessonSummary {
    id: string;
    number: number;
    title: string;
    summary: string;
    completed: boolean;
    current: boolean;
}

export interface TourView {
    lessons: LessonSummary[];
    lesson?: Lesson;
    /** The latest run meets this lesson's goal. */
    goalMet: boolean;
    completed: boolean;
    progress: { done: number; total: number };
    hintsShown: number;
    showHint: () => void;
    solutionShown: boolean;
    showSolution: () => void;
    /** Back to the starter program and host. */
    resetLesson: () => void;
    next?: LessonSummary;
    previous?: LessonSummary;
    resetProgress: () => void;
}

export function lessonStarterWorkspace(lesson: Lesson): Workspace {
    const host = lesson.host;
    return {
        source: lesson.starter,
        host: {
            dataset: typeof host.dataset === 'string' ? host.dataset : null,
            schema: typeof host.dataset === 'string' ? undefined : host.dataset.schema,
            rule: { ...host.rule },
            record: host.record,
            fieldValue: host.fieldValue,
            dataSource: 'postgres'
        }
    };
}

/** Loads a lesson into the workbench (its saved state, or the starter) and tracks its goal. */
export function useTour(lessonId: string | undefined): TourView {
    const lesson = lessons.find(l => l.id === lessonId) ?? lessons[0];
    const completedIds = usePlayground(s => s.completedLessons);
    const report = usePlayground(s => s.report);
    const reportSource = usePlayground(s => s.reportSource);
    const scope = usePlayground(s => s.scope);
    const [hintsShown, setHintsShown] = useState(0);
    const [solutionShown, setSolutionShown] = useState(false);

    useEffect(() => {
        setHintsShown(0);
        setSolutionShown(false);
        const saved = load<Workspace>(`workspace:lesson:${lesson.id}`);
        openLesson(lesson, saved ?? lessonStarterWorkspace(lesson));
    }, [lesson]);

    const active = scope === `lesson:${lesson.id}`;
    const goalMet = active && !!report && reportSource !== undefined && lesson.goal({ report, source: reportSource });

    useEffect(() => {
        if (goalMet) markLessonComplete(lesson.id);
    }, [goalMet, lesson.id]);

    const summaries = useMemo(
        () =>
            lessons.map(l => ({
                id: l.id,
                number: l.number,
                title: l.title,
                summary: l.summary,
                completed: completedIds.includes(l.id),
                current: l.id === lesson.id
            })),
        [completedIds, lesson.id]
    );

    const index = lessons.indexOf(lesson);
    return {
        lessons: summaries,
        lesson,
        goalMet,
        completed: completedIds.includes(lesson.id),
        progress: { done: completedIds.filter(id => lessons.some(l => l.id === id)).length, total: lessons.length },
        hintsShown,
        showHint: () => setHintsShown(n => Math.min(n + 1, lesson.hints.length)),
        solutionShown,
        showSolution: () => {
            setSolutionShown(true);
            const start = lessonStarterWorkspace(lesson);
            openLesson(lesson, {
                source: lesson.solution,
                host: { ...start.host, ...(lesson.solutionHost ?? {}) }
            });
        },
        resetLesson: () => {
            setHintsShown(0);
            setSolutionShown(false);
            openLesson(lesson, lessonStarterWorkspace(lesson));
        },
        next: summaries[index + 1],
        previous: summaries[index - 1],
        resetProgress: resetTourProgress
    };
}
