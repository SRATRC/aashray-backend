# Gate

Admin endpoints for tracking entry and exit at the facility gate.

**Base path:** `/api/v1/admin/gate`
**Auth:** `auth` + `authorizeRoles(ROLE_GATE_ADMIN, ROLE_SUPER_ADMIN)`

## Dashboard Counts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/total` | On-premise count grouped by res_status (PR, MUMUKSHU, SEVA KUTIR, GUEST) |
| GET | `/totalPR` | Residents on premise with last check-in/out timestamps |
| GET | `/totalGuest` | Guests on premise with timing data |
| GET | `/totalMumukshu` | Mumukshus on premise with timing data |
| GET | `/totalSeva` | Seva kutir staff on premise with timing data |

## Gate Operations

### POST /entry

Record a user entering the premises.

**Request body:**
```json
{
  "cardno": "RCOF1234"
}
```

**Side effects:**
- Creates a `gate_record` entry with status `onprem`
- Updates the user's `status` to `onprem` in `card_db`
- Asynchronously updates room/flat booking to `checkedin` if user has a `pending checkin` booking (runs after response via `res.on('finish')`)

### POST /exit

Record a user leaving the premises.

**Request body:**
```json
{
  "cardno": "RCOF1234"
}
```

**Side effects:**
- Creates a `gate_record` entry with status `offprem`
- Updates the user's `status` to `offprem` in `card_db`
- Asynchronously checks for checkout-eligible room/flat bookings and marks them `checkedout`

## History

| Method | Path | Description |
|--------|------|-------------|
| GET | `/gaterecords` | Full gate history with user details (paginated, filterable by date) |
| GET | `/history/:cardno` | Gate history for a specific card |
