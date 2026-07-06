# Utsav

Utsav (festival/event) endpoints for booking, package management, check-in, and admin operations.

---

## Client Endpoints

**Base path:** `/api/v1/utsav`
**Auth:** `validateCard` on all routes

### GET /upcoming

Fetch upcoming utsav events grouped by month. Uses JSON aggregation.

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "month": "April 2026",
      "items": [
        {
          "id": 3,
          "name": "Samvatsari",
          "start_date": "2026-04-15",
          "end_date": "2026-04-18",
          "total_seats": 500,
          "available_seats": 120,
          "location": "Research Centre",
          "status": "open",
          "registration_deadline": "2026-04-10"
        }
      ]
    }
  ]
}
```

### GET /:id

Fetch a single utsav event by ID with its packages.

### GET /booking

View the user's utsav bookings with utsav and package details.

### DELETE /booking

Cancel an utsav booking.

**Side effects:**
- Updates booking status to `cancelled`
- Opens up the seat (increments available_seats)
- Cancels associated transaction

---

## Admin Endpoints

**Base path:** `/api/v1/admin/utsav`

### Public Endpoints (No Auth)

Used from kiosk devices at events:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/utsavCheckin` | Check in a user at an utsav event |
| POST | `/issue/:cardno` | Issue a food plate during an utsav |

### Protected Endpoints

**Auth:** `auth` + `authorizeRoles(ROLE_UTSAV_ADMIN, ROLE_SUPER_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN, ROLE_ACCOUNTS_ADMIN, ROLE_UTSAV_READ_ONLY, ROLE_UTSAV_ADMIN_RAJ)`

#### Event CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | `/create` | Create a new utsav event |
| PUT | `/update/:id` | Update utsav details |
| GET | `/fetch` | Fetch all utsav events |
| GET | `/fetchUtsav` | Events filtered by location |
| GET | `/fetch/:id` | Single event by ID |
| PUT | `/:id/:activate` | Activate or deactivate |
| GET | `/fetchList` | Simplified list for dropdowns |

#### Package Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/package` | Add a package to an utsav |
| POST | `/package/bulk` | Add multiple packages at once |
| PUT | `/updatepackage/:id` | Update a package |
| GET | `/fetchpackage` | Fetch all packages |
| GET | `/fetchPackagesByUtsav` | Packages for a specific utsav |
| GET | `/fetchpackage/:id` | Single package by ID |

**Package request body:**
```json
{
  "utsavid": 3,
  "name": "Full Package",
  "start_date": "2026-04-15",
  "end_date": "2026-04-18",
  "amount": 2500
}
```

#### Booking Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/booking` | Create booking by admin (restricted roles) |
| GET | `/bookings` | Bookings with filtering and pagination |
| GET | `/volunteer` | Bookings for volunteer management |
| PUT | `/status` | Update booking status |

#### Room Assignment and Reports

| Method | Path | Description |
|--------|------|-------------|
| POST | `/uploadRoomNo` | Upload room assignments via Excel |
| PUT | `/updateRoomNo` | Update room number for a booking |
| GET | `/utsavCheckinReport` | Check-in report |
| GET | `/fetchVolunteerOptions` | Volunteer option values |
| GET | `/pre_event_room_occupancy` | Room occupancy before event |
| GET | `/post_event_room_occupancy` | Room occupancy after event |
