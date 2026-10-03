# WiFi

WiFi code management for both clients and admins.

## Client Endpoints

**Base path:** `/api/v1/wifi`
**Auth:** `validateCard` on all routes

### GET /

Fetch temporary WiFi codes assigned to the user.

**Query params:**
- `cardno` (required)

### GET /generate

Generate a temporary WiFi code.

**Query params:**
- `cardno` (required)

**Validation:**
- User must be MUMUKSHU or GUEST type
- User must have an active (checked-in) room booking
- Maximum 3 temporary codes per user (`MAX_WIFI_PASS_LIMIT`)

**Success response (200):**
```json
{
  "message": "WiFi code generated",
  "data": {
    "password": "WIFI-CODE-123"
  }
}
```

### POST /permanent

Request a permanent WiFi code.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "device": "ph"
}
```

The `device` parameter determines the suffix: `ph` (phone), `pc` (computer), `tb` (tablet).

**Side effects:**
- Generates a unique username by stripping card prefixes (RCOF, RCHK, etc.) and appending device suffix
- If username collides, auto-increments a counter
- Creates a pending request in `permanent_wifi_codes` table

### GET /permanent

Fetch the user's permanent WiFi code requests.

### POST /permanent/reset

Request a reset of an approved permanent code.

Changes the status from `approved` to `reset` (pending admin action).

---

## Admin Endpoints

**Base path:** `/api/v1/admin/wifi`
**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN, ROLE_WIFI_ADMIN)`

### POST /uploadcode

Bulk upload temporary WiFi codes via Excel file.

**Content-Type:** `multipart/form-data`

Parses the Excel file and inserts WiFi codes into the `wifi_pwd` table, skipping duplicates.

### GET /wifirecords

Fetch WiFi usage records with filtering.

### GET /permanent

Fetch permanent code requests. Separates new requests (`pending`) from reset requests (`reset`).

### PUT /permanent/:requestId

Approve, reject, or update a permanent code request.

**Request body:**
```json
{
  "status": "approved",
  "code": "PERM-WIFI-123",
  "ssid": "AshramWiFi",
  "admin_comments": "Approved for 1 year"
}
```

**Validation:**
- Prevents assigning duplicate codes
- Admin can freely change status between pending/approved/rejected/reset

### POST /uploadpercode

Bulk update permanent codes via Excel file with dry-run support.

**Query params:**
- `dryRun` -- If true, returns preview without making changes

### POST /insertpercode

Batch insert permanent codes from Excel with dry-run support.

### POST /manual

Add a permanent WiFi code manually (without going through the request flow).

### GET /generate-username

Generate a unique WiFi username for a user.

**Query params:**
- `cardno` -- User's card number
- `device` -- Device type (ph, pc, tb)
