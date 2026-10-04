/** The system clock for a Node host, with a time zone. */

import type { ClockPort } from '../runtime/index.js';

/** The real time, in an IANA time zone (default `UTC`). A bad zone name throws `RangeError` now, not at run time. */
export function systemClock(timeZone = 'UTC'): ClockPort {
    // `Intl` throws a RangeError for a name it does not know.
    new Intl.DateTimeFormat('en', { timeZone });
    return { now: () => new Date(), timeZone };
}
