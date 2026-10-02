# ADR-009: Adhyayan Attendance Pre-Creation and Feedback Windows

## Context

Adhyayan (shibir) events have up to 9 sessions. Attendance needs to be tracked per-session per-attendee. Feedback collection should open after the event ends but close after a reasonable window.

## Decision

### Attendance Pre-Creation

When a booking is confirmed (or promoted from waitlist), an attendance record is **immediately created with all 9 sessions marked as attended** (`session_1` through `session_9` all set to `1`). Admins then **unmark** sessions the attendee missed.

This "default attended, mark absent" pattern is the inverse of what you might expect. It was chosen because most attendees attend all sessions, so it minimizes admin work.

Attendance is **only created for Research Centre** location events. Other locations do not track session-level attendance:

```javascript
if (!shibir || shibir.location !== RESEARCH_CENTRE) return;
```

When a booking is cancelled (by user or cron), `resetShibirAttendance()` zeros out all session flags on the attendance record.

### Feedback Eligibility Window

Users can submit feedback starting from `start_date` of the adhyayan at hour 13 (1:00 PM IST, set via `FEEDBACK_ELIGIBILITY_HOUR`), and the window closes 15 days after that timestamp.

> Note: The feedback window starts from `start_date`, not `end_date`. For multi-day events, feedback opens on day 1 at 1 PM, even while the event is still in progress. The 15-day counter also starts from `start_date`. This means for a 5-day event, the effective feedback window after the event ends is only ~10 days.

Each user can submit exactly one feedback per shibir (enforced by a unique index on `shibir_id` + `cardno`).

### Admin vs User Booking Differences

| Aspect              | User booking                             | Admin booking                                  |
| ------------------- | ---------------------------------------- | ---------------------------------------------- |
| Initial status      | `pending` (if seats + paid) or `waiting` | Always `waiting` if no seats or event not open |
| Transaction created | Yes, immediately                         | No                                             |
| Attendance created  | On confirmation or payment pending       | Only on confirmation                           |

## Consequences

- The "default attended" pattern means new attendance records appear fully attended. If an admin forgets to unmark absences, the record overstates attendance.
- Non-Research-Centre events have no attendance tracking at all, which creates a data gap for reporting across locations.
- The feedback window calculation from `start_date` (not `end_date`) is counterintuitive and may confuse users who expect the window to open after the event concludes.
- Admin-created bookings skip transaction creation, meaning the payment must be handled separately (cash, manual entry, etc.).

## Related Code

- `helpers/adhyayanBooking.helper.js`: `createShibirAttendanceEntry()` lines 513-552, `resetShibirAttendance()` lines 663-682, `validateFeedbackEligibility()` lines 425-453
- `config/constants.js`: `FEEDBACK_ELIGIBILITY_HOUR = 13`
