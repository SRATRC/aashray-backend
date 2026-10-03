# ADR-002: Credit System Design

## Context

When bookings are cancelled after payment, users need some form of refund. Direct bank refunds are NOT supported as per our policy. The system needs a way to issue instant "store credit" that users can apply to future bookings.

## Decision

Credits are stored as a JSON object on the `card_db.credits` field, keyed by booking type. Credits are issued on cancellation and consumed on future bookings of the same type.

### How Credits Work

**Storage:**

```json
{
  "room": 1100,
  "adhyayan": 500,
  "food": 120
}
```

Zero-balance keys are automatically deleted from the JSON to keep it clean.

**Credit issuance (on cancellation):**

- Admin cancellations of completed payments issue credits equal to `amount + discount` (full original value)
- User-initiated cancellations of Travel, Utsav and Adhyayan bookings issue **zero credits** -- the user loses the payment. This is a deliberate business rule.
- Flat credits are stored under the `room` key -- flat and room credits are interchangeable

**Credit consumption (on booking):**

- When creating a new booking, `useCredit()` checks available credits for that booking type
- Credits reduce the transaction amount: `discountedAmount = amount - creditsUsed`
- The `discount` field on the transaction records how much credit was applied
- If credits cover the full amount, no Razorpay order is created

### Validation Without Mutation

During booking validation (`/validate` endpoints), the system needs to calculate charges including credit deductions without actually spending the credits. This is solved by cloning the user's credit object into a `tempUser` and running the calculation against the clone. See `roomBooking.helper.js` `checkRoomAvailabilityForMumukshus()`.

## Consequences

- Credits are type-segregated: room credits can only be used for room bookings (except flat/room which are interchangeable)
- No credit expiration -- credits persist indefinitely
- No audit trail for credit changes beyond the transaction `discount` field and log entries (`credit_added`, `credit_used`)
- Race conditions on concurrent credit usage are possible since credits are stored as a JSON field, not a separate table with row-level locking
- Credit balances can be inspected via `GET /api/v1/admin/card/transactions/:cardno`

## Related Code

- `helpers/transactions.helper.js`: `addCredit()`, `useCredit()`, `usableCredits()`, `getUpdatedCredits()`
- `config/constants.js`: `TYPE_FLAT` mapped to `TYPE_ROOM` for credit purposes
- `helpers/roomBooking.helper.js`: `tempUser` cloning for validation
