# Auth

Authentication endpoints for both the mobile app (client) and admin website.

---

## Client Auth

**Base path:** `/api/v1/client`

### POST /verifyAndLogin

Login with mobile number and password.

**Auth:** None

**Request body:**
```json
{
  "mobno": 9876543210,
  "password": "userpassword"
}
```

**Success response (200):**
```json
{
  "message": "logged in",
  "data": {
    "cardno": "RCOF1234",
    "issuedto": "John Doe",
    "isFlatOwner": false,
    "password": ""
  }
}
```

**Error responses:**
- `404` -- User not found (invalid mobile number)
- `401` -- Invalid password

---

### POST /updatePassword

Change the user's password.

**Auth:** `validateCard`

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "oldPassword": "currentpassword",
  "newPassword": "newpassword123"
}
```

**Success response (200):**
```json
{
  "message": "Password updated successfully"
}
```

**Error responses:**
- `404` -- User not found
- `401` -- Old password incorrect

---

### POST /forgotPassword

Generate a temporary password and email it to the user.

**Auth:** None

**Request body:**
```json
{
  "mobno": 9876543210
}
```

**Success response (200):**
```json
{
  "message": "Password sent to your email"
}
```

**Side effects:** Sends email with temporary 5-character password via the `forgotPasswordEmail` template.

**Error responses:**
- `404` -- User not found
- `400` -- No email on file for user

---

### GET /logout

Log out the current user by clearing their push token.

**Auth:** `validateCard`

**Query params:**
- `cardno` (required) -- User's card number

**Success response (200):**
```json
{
  "message": "logged out"
}
```

---

## Admin Auth

**Base path:** `/api/v1/admin/auth`

### POST /login

Authenticate an admin user and receive a JWT token.

**Auth:** None

**Request body:**
```json
{
  "username": "adminuser",
  "password": "adminpassword"
}
```

**Success response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "roles": ["superAdmin", "roomAdmin"]
}
```

The token should be sent as `Authorization: Bearer <token>` on subsequent requests.

**Error responses:**
- `404` -- User not found
- `401` -- Invalid password
- `401` -- Account deactivated

---

### POST /create

Create a new admin account.

**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN)`

**Request body:**
```json
{
  "username": "newadmin",
  "password": "securepassword",
  "roles": ["roomAdmin", "foodAdmin"]
}
```

**Success response (201):**
```json
{
  "message": "Admin created successfully",
  "data": {
    "id": 5,
    "username": "newadmin"
  }
}
```

**Side effects:** Creates admin user record and role assignments in a transaction.

**Error responses:**
- `400` -- Username already exists
- `401` -- Unauthorized (not superAdmin)

---

### POST /reset-password

Reset an admin's password.

**Auth:** None

**Request body:**
```json
{
  "username": "adminuser",
  "newPassword": "newpassword123"
}
```

**Success response (200):**
```json
{
  "message": "Password reset successfully"
}
```

**Error responses:**
- `404` -- Admin user not found

See [Auth Flow](../../architecture/auth-flow.md) for the complete authentication and authorization architecture.
