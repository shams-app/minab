import { useParams } from 'react-router';
import { useTour } from '../hooks/useTour.js';
import { LessonList, LessonPanel } from '../ui/tour/Tour.js';
import { Workbench } from './Workbench.js';

/** /learn/:lesson — a lesson beside a live workbench, with its goal checked on every run. */
export function LearnPage() {
    const { lesson: lessonId } = useParams();
    const tour = useTour(lessonId);
    const lesson = tour.lesson!;
    return (
        <div className="mb-learn">
            <aside className="mb-learn-side">
                <LessonList lessons={tour.lessons} progress={tour.progress} />
                <LessonPanel
                    lesson={lesson}
                    goalMet={tour.goalMet}
                    completed={tour.completed}
                    hintsShown={tour.hintsShown}
                    onHint={tour.showHint}
                    solutionShown={tour.solutionShown}
                    onSolution={tour.showSolution}
                    onReset={tour.resetLesson}
                    next={tour.next}
                    previous={tour.previous}
                />
            </aside>
            <div className="mb-learn-main">
                <Workbench variant="lesson" editorPath={`lesson/${lesson.id}.minab`} />
            </div>
        </div>
    );
}
