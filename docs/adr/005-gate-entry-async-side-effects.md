# ADR-005: Gate Entry/Exit Async Side Effects

## Context

When a user scans their card at the gate, the system records the entry/exit and responds immediately to keep the gate flow fast. But entry also needs to update the user's room/flat booking status (e.g., mark as `checkedin`), which involves additional database queries.

## Decision

Gate entry and exit operations send the HTTP response immediately after recording the gate event. Booking status updates run **asynchronously after the response** via `res.on('finish', ...)`.

```javascript
// In gateManagement.controller.js
res.status(200).json({ message: 'Entry recorded' });

res.on('finish', async () => {
  // Update flat booking status to checkedin
  // Update room booking status to checkedin
  // Errors are logged but silently swallowed
});
```

### Entry Side Effects

- Flat bookings with `pending checkin` status for today are marked `checkedin`
- Room bookings with `pending checkin` status for today are marked `checkedin`

### Exit Side Effects

- Flat bookings eligible for checkout (today >= checkout date) are marked `checkedout`
- Room bookings are **NOT** auto-checked-out on exit (asymmetric with entry)

## Why

Gate scanning needs to be fast (sub-second response). Booking status updates involve multiple queries and potential locks. Running them synchronously would slow down the gate queue. Since the booking status update is a convenience (not critical path), running it asynchronously with fire-and-forget semantics is acceptable.

## Consequences

- Booking status updates run **outside the database transaction**. If the update fails, the gate record is committed but the booking stays in `pending checkin`. This creates a brief inconsistency that must be resolved manually.
- Errors in the async handler are logged via Winston but do not surface to the client or trigger retries.
- Room bookings are not auto-checked-out on exit. Checkout must be done manually by admin or via the cron job. This asymmetry exists because checkout involves additional logic (late fees, overstay handling) that should not run silently.
- If the server crashes between sending the response and completing the side effect, the booking update is lost.

## Related Code

- `controllers/admin/gateManagement.controller.js`: lines 198-228 (entry side effects), lines 238-281 (exit logic)
