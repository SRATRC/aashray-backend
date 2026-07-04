# ADR-001: India-Only Automatic Payment Cancellation

## Context

The cron job (`cron.js`) runs every 30 minutes and cancels bookings where payment has not been completed within 24 hours (`MAX_APP_PAYMENT_DURATION`). This prevents seats, rooms, and event slots from being held indefinitely by users who abandon the payment step.

However, only **India-based users** are subject to this auto-cancellation. The `getPendingTransactions()` function in `helpers/transactions.helper.js` filters with `country: 'INDIA'` when querying for stale pending transactions.

## Decision

Auto-cancellation of unpaid bookings applies only to users whose `country` field in `card_db` is `INDIA` and payments does not have `CASH` as payment method. Non-India (international) users and any bookings with cash payment flags are excluded from the cron cancellation cycle entirely.

## Why

India-based users pay online via Razorpay. If they don't complete payment within 24 hours, the booking is assumed abandoned. Non-India users typically pay via cash on arrival, so their bookings remain in pending status until manually resolved by an admin. Applying the same 24-hour window to cash-paying international users would incorrectly cancel legitimate bookings.

## Consequences

- International (non-India) users with pending transactions are **never auto-cancelled by cron**. Their bookings/payments can remain in `pending` status indefinitely until an admin manually cancels or confirms them.
- If an international user abandons a booking, the seat/room remains held until manual intervention.
- The `getUnpaidPastBookingsAndTransactions()` function exists in `cron.js` (lines 215-244) but is **commented out**. If enabled, it would cancel room/flat bookings where the check-in date has already passed and payment is still pending, regardless of country. This was disabled deliberately to avoid edge cases with cash payments.

## Related Code

- `cron.js` line 35: `MAX_APP_PAYMENT_DURATION = 24 * 60`
- `helpers/transactions.helper.js` ~line 402: `where: { country: 'INDIA' }`
- `cron.js` line 86: commented-out `getUnpaidPastBookingsAndTransactions()`
