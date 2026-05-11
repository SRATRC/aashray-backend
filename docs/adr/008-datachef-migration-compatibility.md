# ADR-008: DataChef Migration Compatibility

## Context

Before Aashray, the facility used a system called "DataChef" for booking management. Historical data was migrated into the Aashray database. The migrated records have different ID formats and some fields that don't match current conventions.

## Decision

Migrated records are detected at runtime by the `ifMigrated()` function in `helpers/booking.helper.js`:

```javascript
function ifMigrated(transaction) {
  return (
    transaction.bookingid.length < 36 ||
    transaction.description?.includes('came from datachef migration')
  );
}
```

Native Aashray bookings use UUIDs (36 characters). DataChef booking IDs are shorter. The function also checks the transaction description for an explicit migration marker string.

### Where Migration Detection Matters

- **Credit issuance on cancellation:** Migrated adhyayan bookings keep their transaction as `completed` without issuing credits, since the original payment was processed outside Razorpay.
- **Transaction display:** Migrated transactions may have descriptions that reference the old system.

## Consequences

- The detection heuristic (ID length < 36) could false-positive if any non-UUID booking IDs are ever generated for other reasons.
- As the system ages, DataChef records become less relevant but the compatibility code remains in the hot path for every cancellation.
- There is no migration status flag on the transaction or booking record itself -- detection is purely heuristic.

## Related Code

- `helpers/booking.helper.js`: `ifMigrated()` lines 87-97
- `helpers/transactions.helper.js`: used in cancellation credit logic
