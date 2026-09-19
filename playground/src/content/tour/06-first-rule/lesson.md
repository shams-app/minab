Minab's second layer is **validation**. A program that is just a condition over `.` is a *record-level rule*: the host hands it the record about to be saved, and the rule answers `true` or `false`.

Here the host says the rule belongs to the `Booking` table, and the record under validation is in the **Record** tab under the editor. Notice that nothing reaches the database: the answer comes straight from the record (see **Execution**).

### Your turn

The booking in the Record tab fails this rule. Don't change the rule — **fix the record** so the rule passes: edit its dates, or pick the *Fixed dates* preset.
