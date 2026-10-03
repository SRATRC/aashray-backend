# Rooms

Room and flat accommodation endpoints for both client and admin.

---

## Client Endpoints

**Base path:** `/api/v1/stay`
**Auth:** `validateCard` on all routes

### GET /bookings

Fetch all room and flat bookings for a user.

**Query params:**
- `cardno` (required) -- User's card number

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "bookingid": "uuid-string",
      "cardno": "RCOF1234",
      "roomno": "A101",
      "checkin": "2026-04-01",
      "checkout": "2026-04-03",
      "nights": 2,
      "roomtype": "ac",
      "status": "pending checkin",
      "type": "room"
    },
    {
      "bookingid": "uuid-string",
      "cardno": "RCOF1234",
      "flatno": 5,
      "checkin": "2026-04-01",
      "checkout": "2026-04-05",
      "nights": 4,
      "status": "checkedin",
      "type": "flat"
    }
  ]
}
```

Uses a UNION query to combine room and flat bookings into a single list.

### POST /cancel

Cancel a room or flat booking.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "bookingid": "uuid-string"
}
```

**Side effects:**
- Updates booking status to `cancelled`
- Cancels associated transaction
- Sends push notification to the booked user
- If the booking was made by someone else (bookedBy), notifies both parties

**Error responses:**
- `404` -- Booking not found
- `400` -- Cannot cancel already cancelled booking

### POST /flat

Book a flat for mumukshu users.

> Warning: This endpoint is marked as DEPRECATED. Use [Bookings](bookings.md) endpoints instead.

---

## Admin Endpoints

**Base path:** `/api/v1/admin/stay`
**Auth:** `auth` + `authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN)`

### Room Booking Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bookForMumukshu` | Book a room for a mumukshu on behalf of admin |
| PUT | `/checkin/:bookingid` | Manual check-in for a room booking |
| PUT | `/checkout/:bookingid` | Manual check-out for a room booking |
| PUT | `/update_room_booking` | Update details of an existing room booking |
| PUT | `/update_booking_status` | Update booking status (waiting -> pending -> confirmed) |
| GET | `/fetch_room_bookings/:cardno` | Fetch all room bookings for a card |

### Room Inventory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/room_list` | List all rooms with current status |
| GET | `/available_rooms/:bookingid` | Available rooms for a booking's requirements |
| GET | `/available_rooms_for_day` | Available rooms for a date range and type |
| PUT | `/block_room/:roomno` | Block a room from booking |
| PUT | `/unblock_room/:roomno` | Unblock a room |
| PUT | `/update_room/:roomno` | Update room details (type, gender) |

### RC Block Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/block_rc` | Block a date range for the Research Centre |
| PUT | `/unblock_rc/:id` | Remove a date block |
| GET | `/rc_block_list` | List all active date blocks |

### Flat Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bookFlat/:mobno` | Book a flat by mobile number |
| PUT | `/flat_checkin/:bookingid` | Manual flat check-in |
| PUT | `/flat_checkout/:bookingid` | Manual flat check-out |
| PUT | `/flat_cancel/:bookingid` | Cancel a flat booking |
| GET | `/flat_list` | List all flats with owners |
| GET | `/fetch_flat_bookings/:cardno` | Flat bookings for a card |
| PUT | `/update_flat_booking_status` | Update flat booking status |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reservation_report` | Room reservation report with occupancy |
| GET | `/flat_reservation_report` | Flat reservation report |
| GET | `/daywise_report` | Day-wise guest count report |
| GET | `/occupancyReport` | Room occupancy percentage |
| GET | `/guestsByDateAndRoomtype` | Guests by date and room type |
| GET | `/late-checkout-fees` | Late check-out fee records |
| PUT | `/late-checkout-fees/revoke` | Revoke a late check-out fee |
