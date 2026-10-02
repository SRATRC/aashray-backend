# Food

Meal booking, plate issuance, menu management, and reporting endpoints.

---

## Client Endpoints

**Base path:** `/api/v1/food`
**Auth:** `validateCard` on all routes

### GET /get

Fetch food bookings for the current user.

**Query params:**
- `cardno` (required) -- User's card number
- `page` -- Page number (default 1)
- `page_size` -- Items per page

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "id": "uuid-string",
      "cardno": "RCOF1234",
      "date": "2026-04-01",
      "breakfast": true,
      "lunch": true,
      "dinner": false,
      "hightea": "NONE",
      "spicy": false
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalCount": 25,
    "totalPages": 3,
    "hasMore": true
  }
}
```

Uses a UNION query that splits each food booking row into separate meal rows (breakfast, lunch, dinner) with filtering support.

### GET /getGuestsForFilter

Fetch guest list for the food booking filter dropdown.

**Query params:**
- `cardno` (required) -- Host card number

### PATCH /cancel

Cancel food bookings for specific meals.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "bookings": [
    { "id": "uuid-string", "date": "2026-04-01", "meal": "breakfast" },
    { "id": "uuid-string", "date": "2026-04-01", "meal": "lunch" }
  ]
}
```

### GET /menu

Fetch the food menu for a date range.

**Query params:**
- `cardno` (required)
- `start_date` -- Start date (YYYY-MM-DD)
- `end_date` -- End date (YYYY-MM-DD)

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "date": "2026-04-01",
      "breakfast": "Poha, Tea, Juice",
      "lunch": "Dal, Rice, Roti, Sabzi",
      "dinner": "Khichdi, Kadhi, Papad"
    }
  ]
}
```

---

## Admin Endpoints

**Base path:** `/api/v1/admin/food`
**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_SMILESTONES_ADMIN)`

### Plate Issuance

| Method | Path | Description |
|--------|------|-------------|
| POST | `/issue/:cardno` | Issue a food plate to a user for today |
| POST | `/issue/bulk` | Bulk issue plates to multiple users |
| POST | `/physicalPlates` | Record physical plate counts for a meal |
| GET | `/physicalPlates` | Fetch physical plate count records |
| PUT | `/update_plate_issued/:bookingid` | Update plate issued status (same-day only) |

### Booking Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/book` | Book meals for a single person |
| GET | `/fetch_food_bookings` | Fetch future food bookings with filtering |
| PUT | `/cancel/:bookingid` | Cancel a single meal booking |
| PUT | `/cancel_multiple` | Cancel multiple meals in batch |
| POST | `/meal-count` | Meal count totals by mobile number |

**Book request body:**
```json
{
  "cardno": "RCOF1234",
  "date": "2026-04-01",
  "breakfast": true,
  "lunch": true,
  "dinner": false,
  "spicy": false,
  "hightea": "NONE"
}
```

### Bulk Booking (Group Orders)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bulk_booking` | Create bulk food bookings for departments/groups |
| GET | `/bulk_booking` | Fetch existing bulk bookings |
| PUT | `/edit_bulk_booking/:bookingid` | Edit a bulk booking |

**Bulk booking request body:**
```json
{
  "cardno": "RCOF1234",
  "date": "2026-04-01",
  "guestCount": 50,
  "breakfast": 50,
  "lunch": 45,
  "dinner": 30,
  "department": "RC"
}
```

> Note: Bulk booking has time-based restrictions. Depending on the admin role, orders may be restricted to certain cutoff times.

### Menu Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/menu` | Fetch menu for a date range |
| POST | `/menu` | Add a menu entry for a single date |
| PUT | `/menu` | Update an existing menu entry |
| DELETE | `/menu` | Delete a menu entry |
| POST | `/menu/bulk` | Bulk upload menus with upsert logic |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/report` | Aggregated food report with meal counts and plate data |
| GET | `/report_details` | Detailed list of meals with issued/not-issued status |
| GET | `/report_details_guests` | Guest meal details with dynamic columns |
