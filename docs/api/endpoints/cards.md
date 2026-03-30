# Cards

Admin endpoints for managing user cards (user accounts).

**Base path:** `/api/v1/admin/card`
**Auth:** `auth` + `authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_CARD_ADMIN, ROLE_UTSAV_ADMIN, ROLE_WIFI_ADMIN, ROLE_FOOD_ADMIN)`

## POST /create

Create a new user card.

**Request body:**
```json
{
  "cardno": "RCOF5678",
  "issuedto": "New User",
  "gender": "M",
  "mobno": 9876543210,
  "email": "user@example.com",
  "res_status": "GUEST",
  "status": "offprem",
  "password": "initialpassword",
  "parentCardno": "RCOF1234"
}
```

If `parentCardno` is provided, creates a guest relationship linking this card to the parent.

**Side effects:** Transactional -- creates card and guest relationship atomically.

**Error responses:**
- `400` -- Card number already exists
- `404` -- Parent card not found (if `parentCardno` provided)

## Other Operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/getAll` | Fetch all cards |
| GET | `/search/:name` | Search by name, mobile, or card number (SQL LIKE) |
| GET | `/by-mobile/:mobno` | Fetch card by mobile number |
| PUT | `/update` | Update card details (handles guest relationship changes) |
| PUT | `/transfer` | Transfer card number (`oldCardno` -> `newCardno`) |
| GET | `/transactions/:cardno` | Transaction summary via raw SQL aggregation |
| POST | `/reset-pwd` | Reset password to default |
