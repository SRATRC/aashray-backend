# Bookings

Unified booking endpoints for guests and mumukshus, plus admin cross-type cancellation.

These are the primary booking creation endpoints. They handle room, food, adhyayan, utsav, and flat bookings in a single request.

---

## Guest Booking

**Base path:** `/api/v1/guest`
**Auth:** `validateCard` on all routes

### GET /

Fetch all guests associated with the current user.

### POST /

Create guest profiles.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "guests": [
    {
      "name": "Guest Name",
      "gender": "M",
      "mobno": "9876543210",
      "type": "relative"
    }
  ]
}
```

### GET /check/:mobno

Check if a guest exists by mobile number.

### POST /validate

Pre-validate a booking. Returns calculated charges without creating the booking.

**Success response (200):**
```json
{
  "message": "Validation successful",
  "data": {
    "charges": {
      "room": 2200,
      "food": 600,
      "adhyayan": 500,
      "total": 3300
    }
  }
}
```

### POST /booking

Create a unified booking for one or more guests. This is the main booking endpoint that handles multiple booking types in a single transaction.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "guests": [
    { "cardno": "RCOF5678", "name": "Guest Name", "gender": "M" }
  ],
  "room": {
    "checkin": "2026-04-01",
    "checkout": "2026-04-03",
    "roomtype": "ac"
  },
  "food": {
    "start_date": "2026-04-01",
    "end_date": "2026-04-03",
    "breakfast": true,
    "lunch": true,
    "dinner": true,
    "spicy": false,
    "hightea": "NONE"
  },
  "adhyayan": [15],
  "utsav": {
    "utsavid": 3,
    "packageid": 7,
    "arrival": "2026-04-01"
  }
}
```

**Processing steps:**
1. Validates all booking constraints (dates, availability, duplicates, blocked dates)
2. Creates room bookings (allocates rooms by gender and type)
3. Creates food bookings for the date range
4. Creates adhyayan registrations
5. Creates utsav bookings with package selection
6. Creates payment transactions for all bookings
7. For Indian users, generates a Razorpay order for online payment
8. Sends unified booking confirmation email

**Success response (200):**
```json
{
  "message": "Booking successful",
  "data": {
    "orderId": "order_razorpay_id",
    "amount": 3300,
    "bookings": { ... }
  }
}
```

If the total amount is 0 (free bookings), no Razorpay order is created.

**Error responses:**
- `400` -- Dates blocked / Room already booked / Adhyayan already booked / Utsav already booked / No beds available

### POST /flat

> Warning: DEPRECATED.

---

## Mumukshu Booking

**Base path:** `/api/v1/mumukshu`
**Auth:** `validateCard` on all routes

### GET /

Check if the user is a mumukshu or guest type. Returns `res_status`.

### POST /validate

Pre-validate a mumukshu booking. Returns calculated charges.

### POST /booking

Create a unified booking for one or more mumukshus. Same processing logic as guest booking with these differences:

- Mumukshus can book flats (if the booking user owns a flat)
- Flat booking validates that the flat is not already booked for the requested dates

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "mumpiCardno": ["RCOF5678", "RCOF9012"],
  "room": {
    "checkin": "2026-04-01",
    "checkout": "2026-04-03",
    "roomtype": "nac"
  },
  "food": { ... },
  "adhyayan": [15],
  "flat": {
    "checkin": "2026-04-01",
    "checkout": "2026-04-03"
  }
}
```

---

## Admin Booking Cancellation

**Base path:** `/api/v1/admin/bookings`
**Auth:** `auth` + `authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN)`

### PUT /cancel/:type/:bookingid

Cancel a booking of any type (room or flat).

**Path params:**
- `type` -- `room` or `flat`
- `bookingid` -- UUID booking identifier

**Processing:**
1. Validates booking exists and is not already cancelled
2. Updates booking status to `admin cancelled`
3. Cancels the associated transaction
4. Sends push notification to affected user (and bookedBy if applicable)

**Error responses:**
- `404` -- Booking not found
- `400` -- Cannot cancel already cancelled booking
