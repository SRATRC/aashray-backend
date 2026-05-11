# ADR-012: UtsavBooking hasOne Relationship

**Status:** NEEDS FIX ⚠️ (Likely a BUG)

## Context

In `models/associations.js`, the relationship between `CardDb` and `UtsavBooking` is defined as `hasOne`:

```javascript
CardDb.hasOne(UtsavBooking, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});
```

All other booking types (Room, Flat, Food, Shibir, Travel) use `hasMany`.

## Impact

`hasOne` means Sequelize will return only **one** UtsavBooking when using eager loading (`include: [UtsavBooking]`). If a user has multiple Utsav bookings (different events or packages), only the most recent one will be loaded in queries that use the association.

This does not affect direct queries like `UtsavBooking.findAll({ where: { cardno } })` which bypass the association and correctly return all bookings.

## Why It Exists

This is most likely unintentional. The booking flow does create multiple Utsav bookings per user (one per event). Most queries in the codebase use direct `findAll` rather than eager loading through the association, which masks the issue in practice.

## Consequences

- Any code using `CardDb.findOne({ include: [UtsavBooking] })` will silently return only one booking
- The utsav booking controller's `ViewUtsavBookings` queries `UtsavBooking` directly, so it works correctly
- If someone adds eager loading through CardDb in the future, they will get incomplete results

## Related Code

- `models/associations.js`: lines 116-128
