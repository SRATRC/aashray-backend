# Adhyayan

Adhyayan (study/retreat program) endpoints for registration, feedback, attendance, and admin management.

---

## Client Endpoints

**Base path:** `/api/v1/adhyayan`
**Auth:** `validateCard` on all routes

### GET /getall

Fetch all upcoming adhyayan events grouped by month.

**Query params:**
- `cardno` (required)

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "month": "April 2026",
      "items": [
        {
          "id": 15,
          "name": "Param Gyaan Sabha",
          "speaker": "Speaker Name",
          "start_date": "2026-04-10",
          "end_date": "2026-04-12",
          "location": "Research Centre",
          "total_seats": 100,
          "available_seats": 45,
          "amount": 500,
          "status": "open"
        }
      ]
    }
  ]
}
```

### GET /getbooked

Fetch user's booked adhyayan events with feedback eligibility.

Each booking includes a `feedbackEligible` flag calculated based on:
- The event has ended (start_date + FEEDBACK_ELIGIBILITY_HOUR has passed)
- Within the 15-day feedback window
- User has not already submitted feedback

### GET /:id

Fetch a single adhyayan event by ID.

### GET /getrange

Fetch adhyayan events within a date range. Defaults to today + 15 days.

### DELETE /cancel

Cancel an adhyayan booking.

**Side effects:**
- Updates booking status to `cancelled`
- Resets attendance data if any was recorded
- Opens up the seat (increments available_seats)
- Cancels associated transaction

### POST /feedback

Submit feedback for a completed adhyayan.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "shibir_id": 15,
  "swadhay_karta_rating": 4,
  "personal_interaction_rating": 5,
  "swadhay_karta_suggestions": "Very insightful sessions",
  "raj_adhyayan_interest": true,
  "future_topics": "Advanced meditation techniques",
  "loved_most": "The interactive Q&A sessions",
  "improvement_suggestions": "More breaks between sessions",
  "food_rating": 4,
  "stay_rating": 5
}
```

**Validation:** All ratings 1-5, text fields max 1000 chars, must be within feedback window, one per user per shibir.

**Error responses:**
- `400` -- `ERR_FEEDBACK_ALREADY_SUBMITTED`
- `400` -- `ERR_FEEDBACK_NOT_ALLOWED`
- `400` -- `ERR_ADHYAYAN_NOT_COMPLETED`

### GET /feedback/validate

Check if the user is eligible to submit feedback.

---

## Admin Endpoints

**Base path:** `/api/v1/admin/adhyayan`
**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN, ROLE_ADHYAYAN_ADMIN, ROLE_OFFICE_ADMIN, ROLE_DHU_ADHYAYAN_ADMIN, ROLE_RAJ_ADHYAYAN_ADMIN, ROLE_KOL_ADHYAYAN_ADMIN, ROLE_ACCOUNTS_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN, ROLE_ADHYAYAN_READ_ONLY, ROLE_UTSAV_ADMIN)`

### Event CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | `/create` | Create a new adhyayan event (`available_seats` auto-set to `total_seats`) |
| GET | `/fetchALLadhyayan` | All events with booking count aggregation |
| GET | `/fetchAdhyayan` | Events filtered by location |
| GET | `/fetchPGS` | "Param Gyaan Sabha" events specifically |
| GET | `/fetch/:id` | Single event by ID |
| PUT | `/update/:id` | Update event (adjusts `available_seats` when `total_seats` changes) |
| PUT | `/:id/:activate` | Activate or soft-delete an event |
| DELETE | `/:id` | Soft delete with mass notification to booked users |
| GET | `/fetchList` | Simplified list for dropdowns |

**Create request body:**
```json
{
  "name": "Param Gyaan Sabha",
  "speaker": "Speaker Name",
  "month": "April 2026",
  "start_date": "2026-04-10",
  "end_date": "2026-04-12",
  "location": "Research Centre",
  "total_seats": 100,
  "amount": 500,
  "food_allowed": true
}
```

### Booking Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/bookings` | Bookings with status filtering and pagination |
| GET | `/waitlist/:id` | Waiting list for an event |
| GET | `/pendinglist/:id` | Pending payment list |
| PUT | `/status` | Update booking status (complex transitions) |
| POST | `/booking/admin` | Batch-create bookings for multiple users |

**Status update transitions:**
- `waiting` -> `confirmed` (reserves seat, creates transaction)
- `confirmed` -> `cancelled` (opens seat, promotes waitlist)
- Any -> `admin cancelled`

**Side effects:** Creates/cancels transactions, adjusts seats, promotes waitlist, creates attendance entries, sends notifications and emails.

### Attendance

| Method | Path | Description |
|--------|------|-------------|
| POST | `/attendance/:shibir_id/:session_no/:cardno` | Mark attendance for a session |
| PUT | `/attendance/toggle` | Toggle attendance for a session |
| GET | `/attendance/report/:shibir_id` | Attendance report with dynamic session data |
| GET | `/attendance/summary/:shibir_id` | Summarized counts by session |
| POST | `/attendance/create` | Manually create an attendance entry |

### Feedback

| Method | Path | Description |
|--------|------|-------------|
| GET | `/feedback/:shibir_id` | All feedback with aggregated stats, paginated |
