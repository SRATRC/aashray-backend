# ADR-004: Samvatsari Package Mutual Exclusivity

## Context

Utsav (festival) events offer multiple packages with different date ranges and pricing. The Samvatsari event has a specific package (ID 21) that overlaps in dates with two other packages (IDs 18 and 20). Allowing a user to book both would result in double-counted attendance and duplicate charges for overlapping dates.

## Decision

Package ID 21 (Samvatsari) is **mutually exclusive** with package IDs 18 and 20. These IDs are hardcoded in `helpers/utsavBooking.helper.js`:

```javascript
const SAMVATSARI_PACKAGE_ID = 21;
const SAMVATSARI_OVERLAPPING_PACKAGE_IDS = [18, 20];
```

Before creating an Utsav booking, `checkOverlapWithSamvatsari()` runs a raw SQL query that checks:

- If the user is booking package 21: rejects if they already have package 18 or 20
- If the user is booking package 18 or 20: rejects if they already have package 21

## Why Not a Generic Overlap Check

A generic date-based overlap check across all packages would be more flexible, but the business requirement is specifically about these three packages. Other packages for the same Utsav can coexist even if their dates overlap. The mutual exclusivity is a business rule about the nature of these specific packages (Samvatsari is a comprehensive package that subsumes the other two), not a calendaring constraint.

## Consequences

- Adding new mutually exclusive packages requires a code change to these hardcoded constants. There is no admin UI or database configuration for package exclusivity rules.
- If these package IDs change (e.g., the Utsav is recreated with new IDs), the exclusivity check will silently stop working.
- The check uses a raw SQL query for performance, not Sequelize ORM methods.

## Related Code

- `helpers/utsavBooking.helper.js`: lines 34-35 (constants), lines 200-241 (`checkOverlapWithSamvatsari`)
