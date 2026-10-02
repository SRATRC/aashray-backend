# Travel

Travel booking endpoints for both client and admin.

---

## Client Endpoints

**Base path:** `/api/v1/travel`
**Auth:** `validateCard` on all routes

### GET /booking

Fetch upcoming travel bookings for the user.

**Query params:**
- `cardno` (required)
- `page` -- Page number
- `page_size` -- Items per page

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "bookingid": "uuid-string",
      "cardno": "RCOF1234",
      "date": "2026-04-10",
      "pickup_point": "Mumbai",
      "drop_point": "Research Centre",
      "type": "Regular",
      "luggage": "1 bag",
      "status": "confirmed",
      "arrival_time": "10:00 AM"
    }
  ]
}
```

### DELETE /booking

Cancel a travel booking.

**Query params:**
- `cardno` (required)
- `bookingid` (required)

**Side effects:**
- Updates booking status to `cancelled`
- Cancels associated transaction
- Promotes next waiting booking if available (moves to `awaiting confirmation`)
- Sends email notification about cancellation
- Sends email to promoted waiting-list user

---

## Admin Endpoints

**Base path:** `/api/v1/admin/travel`
**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN, ROLE_TRAVEL_ADMIN, ROLE_DRI_TRAVEL_ADMIN)`

### GET /upcoming

Fetch upcoming travel bookings with details. Handles "other" pickup/drop locations by substituting the user's comments field.

### GET /summary

Aggregated travel summary grouped by destination. Groups bookings into directional categories (e.g., Mumbai to RC, RC to Mumbai) with counts by status and location.

### GET /driver

Fetch bookings for driver's daily manifest. Uses an 8:00 PM IST cutoff for the current day. Returns bookings sorted for driver efficiency.

### POST /booking/status

Update booking status with complex transition handling.

**Request body:**
```json
{
  "bookingid": "uuid-string",
  "cardno": "RCOF1234",
  "status": "confirmed",
  "issueCredits": false
}
```

**Status transitions:**
- `waiting` -> `awaiting confirmation`
- `awaiting confirmation` -> `confirmed` / `proceed for payment`
- Any -> `cancelled` / `admin cancelled` (with optional credit issuance)

**Side effects:**
- Creates/updates payment transactions
- Issues credits on cancellation if `issueCredits` is true
- Promotes next waiting booking on cancellation
- Sends email and push notifications

### POST /transaction/status

Update a specific transaction's status.

### PUT /bookingupdate

Update booking details (amount, dates, comments) within a transaction.
