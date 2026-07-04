# ADR-007: Late Checkout Fees as Standalone Transactions

## Context

When a guest checks out after the 11:00 AM deadline, a late checkout fee is charged. This fee needs to appear in the user's transaction history and be payable, but it is not associated with a new room booking.

## Decision

Late checkout fees are created as standalone transactions with a **generated UUID as the bookingid** that does not correspond to any entry in `room_booking`. The `amt_type` field is set to `AMT_TYPE_LATE_CHECKOUT_ROOM` (`'late_checkout_room'`) to distinguish these from normal booking transactions.

### Fee Schedule

| Checkout Time       | Fee               |
| ------------------- | ----------------- |
| Before 11:00 AM     | No fee            |
| 11:00 AM to 3:00 PM | 50% of room rate  |
| After 3:00 PM       | 100% of room rate |

Day visits (`nights: 0`) are never charged late fees.

### Overstay Handling

A separate `handleOverstayCheckout()` function exists that would create an auto-extension booking for guests who stay past their checkout date. This function is **currently commented out** in `roomManagement.controller.js`. If enabled, it would create a new `room_booking` record for the overstay nights and immediately mark it as checked out, effectively billing for the extra nights.

## Consequences

- Late checkout transactions have no corresponding `room_booking` row. Queries that join transactions to bookings will not find a match for these entries. The `amt_type` field must be checked to identify them.
- The fee amounts are hardcoded in the controller, not in `config/constants.js` alongside other pricing.
- Overstay handling is disabled. Guests who stay past their checkout date are simply marked as checked out with no additional charge. Enabling it requires uncommenting code and testing the nested transaction logic.
- Early checkout creates a **nested transaction** within the main checkout flow to handle the refund atomically -- this is complex and could deadlock under edge conditions.

## Related Code

- `controllers/admin/roomManagement.controller.js`: lines 68-76 (thresholds), 94-111 (fee creation), 131-165 (`handleOverstayCheckout`), 170-264 (`handleEarlyCheckout`), 365-370 (commented-out overstay call)
