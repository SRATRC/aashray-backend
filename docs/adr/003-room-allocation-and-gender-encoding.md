# ADR-003: Room Allocation and Gender Encoding

## Context

The facility has rooms organized by floor/wing and separated by gender. The booking system needs to allocate the right room type to each user while respecting gender separation rules and floor preferences.

## Decision

### Gender Field Encoding

The `gender` field on `room_booking` and `roomdb` is **not just M/F**. It encodes floor preference + gender as a concatenated string:

| Value | Meaning                                   |
| ----- | ----------------------------------------- |
| `M`   | Male (no floor preference)                |
| `F`   | Female (no floor preference)              |
| `SCM` | South-Center floor, Male                  |
| `SCF` | South-Center floor, Female                |
| `NA`  | Not applicable (day visits, waiting list) |

The gender value is constructed at booking time: `gender = floor_pref + user_gender`. If `floor_pref = 'SC'` and the user is Male, gender becomes `'SCM'`. This value is used to match rooms in `roomdb` where rooms are pre-assigned to gender categories.

### WL (Waiting List) Rooms

Rooms with numbers starting with `WL` (e.g., `WL01`, `WL02`) exist in `roomdb` but are **never allocated to bookings**. They are explicitly excluded from all room queries via `roomno NOT LIKE 'WL%'`. These appear to be placeholder entries, possibly for reporting or legacy compatibility.

### Day Visits

Day visits create a booking with `nights: 0`, `roomno: 'NA'`, `roomtype: 'NA'`, `gender: 'NA'`. They go through the same booking flow but skip room allocation entirely. Status is `pending checkin` like regular bookings.

### Room Number Format and Allocation Order

Room numbers follow a format like `101A`, `202B`. Allocation sorts by numeric prefix first, then alphabetic suffix, and assigns the **lowest-numbered available room**:

```sql
CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED),
SUBSTRING(roomno, LENGTH(roomno))
```

### Utsav Boundary Waiting

If a room booking is for a single night and the check-in/check-out dates cross an Utsav event boundary, the booking is automatically placed in `waiting` status instead of allocating a room. This prevents short stays from consuming rooms needed for the event.

## Consequences

- The `gender` field is overloaded -- it stores floor preference + gender, not just gender. New developers may expect simple M/F values.
- Room queries must always exclude `WL%` rooms. Forgetting this filter would allocate placeholder rooms.
- Day visits (`nights: 0`) and real bookings share the same table and status flow, which can cause confusion in checkout logic.
- Room allocation is deterministic (lowest number first) but does not consider proximity, floor preference beyond the gender encoding, or room condition.

## Related Code

- `helpers/roomBooking.helper.js`: line ~401 (gender construction), lines 211-212 (WL exclusion), lines 82-111 (`bookDayVisit`), lines 235-240 (sort order), lines 404-429 (utsav boundary)
