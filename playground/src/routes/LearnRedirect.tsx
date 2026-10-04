import { Navigate } from 'react-router';
import { lessons } from '../content/tour/index.js';

/** /learn opens the first lesson. It is its own file so the tour content loads only on the tour routes. */
export function LearnRedirect() {
    return <Navigate to={`/learn/${lessons[0].id}`} replace />;
}
