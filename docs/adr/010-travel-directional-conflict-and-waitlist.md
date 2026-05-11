# ADR-010: Travel Directional Conflict Detection and Waitlist

## Context

The facility arranges transport between locations (primarily Mumbai and Research Centre). Users book one-way trips. The system needs to prevent illogical bookings (e.g., two trips in the same direction on the same day) and manage limited transport capacity via a waiting list.

## Decision

### Directional Conflict Detection

`checkTravelAlreadyBooked()` prevents a user from having two active bookings in the **same direction** on the same date. Direction is determined by whether the drop point is Research Centre:

- Going TO Research Centre: `drop_point === 'Research Centre'`
- Going FROM Research Centre: `pickup_point === 'Research Centre'`

The check queries for existing non-cancelled bookings on the same date with the same directional pattern. A user CAN have two bookings on the same day if they are in opposite directions (arrive in morning, depart in evening).

### Waitlist Promotion

When a travel booking is cancelled, `updateWaitingTravelBooking()` finds the **oldest waiting booking** (by `createdAt`, FIFO) for the same date and direction, and promotes it to `awaiting confirmation` (not directly to `confirmed`).

The `awaiting confirmation` status requires admin review before the booking is finalized. This is different from adhyayan waitlist promotion, which goes directly to `confirmed` with a pending payment.

### Utsav Auto-Waitlist Does Not Promote

Unlike adhyayan and travel, Utsav waitlist bookings are **not automatically promoted** when a seat opens. The cron job calls `openUtsavSeat()` which increments `available_seats` but does not move any waiting booking to a payment or confirmed state. This is noted in a code comment: "Not automatically moving from waiting to payment pending for now."

## Consequences

- Travel waitlist promotion requires manual admin confirmation (`awaiting confirmation` -> `confirmed`), adding a human step to the process.
- Utsav waitlist users are never automatically notified when a seat opens. They remain in `waiting` status until an admin manually updates them.
- The directional logic depends on exact string matching of `'Research Centre'`. If pickup/drop point names change or new locations are added, the conflict detection may not work correctly.

## Related Code

- `helpers/travelBooking.helper.js`: `checkTravelAlreadyBooked()` lines 24-56, `updateWaitingTravelBooking()` lines 58-99
- `helpers/utsavBooking.helper.js`: `openUtsavSeat()` and the comment about not auto-promoting
- `config/constants.js`: `RESEARCH_CENTRE = 'Research Centre'`
