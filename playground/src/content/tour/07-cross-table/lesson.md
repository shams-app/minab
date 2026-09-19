Rules can look beyond the record. **`#Booking`** opens the whole `Booking` table inside an expression, and square brackets filter it. Inside the filter, `.` is each *other* booking — and **`^`** reaches one level up, to the booking being validated.

Watch the **Execution** tab: the date check is still answered in memory, and only `EXISTS(#Booking[…])` becomes SQL — a single indexed lookup, not a table scan. Hover the statement to see which part of your rule it came from.

### Your turn

Extend the rule so it also fails when **another booking of the same room overlaps** this one. Two bookings overlap when each starts before the other ends. Then try the *Overlaps bkg-12* preset.
