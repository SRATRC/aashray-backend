# Maintenance

Maintenance request endpoints for both client and admin.

## Client Endpoints

**Base path:** `/api/v1/maintenance`
**Auth:** `validateCard` on all routes

### POST /request

Create a new maintenance request.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "department": "Housekeeping",
  "work_detail": "AC not working in room A101",
  "area_of_work": "Room A101"
}
```

**Validation:** User must be a resident (PR), mumukshu, seva kutir, or currently checked in.

**Side effects:**
- Sends email notification to the user
- Sends email notification to the department (using `dept_email` from `departments` table)

**Success response (200):**
```json
{
  "message": "Request created successfully",
  "data": {
    "bookingid": "uuid-string"
  }
}
```

### GET /

View maintenance requests for the user.

**Query params:**
- `cardno` (required)
- `status` -- Filter by status (open, closed, in progress)
- `page`, `page_size` -- Pagination

### GET /departments

Fetch available departments for the maintenance request form.

---

## Admin Endpoints

**Base path:** `/api/v1/admin/maintenance`
**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN, ROLE_MAINTENANCE_ADMIN, ROLE_HOUSEKEEPING_ADMIN, ROLE_ELECTRICAL_ADMIN)`

### GET /fetch/:department

Fetch maintenance requests by department with status priority ordering.

**Path params:**
- `department` -- Department name

### PUT /update

Update a maintenance request (status, comments).

**Request body:**
```json
{
  "bookingid": "uuid-string",
  "status": "in progress",
  "comments": "Technician assigned, will fix by tomorrow"
}
```

**Status options:** `open`, `in progress`, `closed`
