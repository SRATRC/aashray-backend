# ADR-006: Food Booking Requires Accommodation or Adhyayan Enrollment

## Context

The facility provides meals to residents and guests. Meals should only be booked by people who are actually staying at the facility, not by arbitrary card holders remotely.

## Decision

Food bookings enforce that the user must have a valid reason to be on-premise. The validation in the food booking flow checks these conditions (in order):

1. User is a permanent resident (`PR`), seva kutir (`SEVA KUTIR`), or guest (`GUEST`) by `res_status` -- always allowed
2. User has an active room booking covering the food dates (`checkRoomBookingProgress()`)
3. User has a flat booked for the dates (`checkFlatAlreadyBooked()`)
4. User is enrolled in an adhyayan (shibir) that has `food_allowed: true` AND the food dates fall within the shibir date range (`checkSpecialAllowance()`)

If none of these conditions are met, the booking is rejected with `ERR_ROOM_MUST_BE_BOOKED`.

### Adhyayan Food Allowance

Not all adhyayan events include meals. The `shibir_db.food_allowed` boolean flag controls this per-event. When `food_allowed` is true, enrolled users can book food for the exact date range of the adhyayan without needing a separate room booking.

### Utsav Date Exclusion

When a user books food that overlaps with an Utsav event they're attending, the food dates during the Utsav are excluded. The `getDatesDuringUtsav()` function strips Utsav-period dates from the food booking range, since Utsav meals are handled separately through the Utsav booking itself. Boundary dates (first/last day of Utsav) are also excluded.

## Consequences

- Mumukshu users without a room or flat booking cannot book food unless they're in a food-allowed adhyayan. This can be confusing for users who are on-premise but haven't formalized their stay booking yet.
- The accommodation check is per-date: if a room booking covers April 1-3 but the user tries to book food for April 1-5, the April 4-5 portion may be rejected.
- Admin food booking (`POST /api/v1/admin/food/book`) may bypass some of these checks depending on role.

## Related Code

- `helpers/foodBooking.helper.js`: accommodation validation logic
- `controllers/helper.js`: `checkSpecialAllowance()` lines 144-213
- `helpers/foodBooking.helper.js`: `getDatesDuringUtsav()` for event date exclusion
