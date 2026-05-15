# Admin Controls (Super Admin)

System administration endpoints for managing admin accounts and roles.

**Base path:** `/api/v1/admin/sudo`
**Auth:** `auth` + `authorizeRoles(ROLE_SUPER_ADMIN)` on all routes

## Admin Management

### GET /fetch_all_admins

Fetch all admin accounts sorted by status (active first) and username.

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "id": 1,
      "username": "adminuser",
      "status": "active",
      "admin_roles": [
        { "role_name": "superAdmin", "status": "active" },
        { "role_name": "roomAdmin", "status": "active" }
      ]
    }
  ]
}
```

### PUT /update_roles

Update an admin's role assignments.

**Request body:**
```json
{
  "user_id": 5,
  "roles": ["roomAdmin", "foodAdmin", "gateAdmin"]
}
```

Soft-deletes existing role assignments and creates new ones in a transaction.

### PUT /deactivate/:username

Deactivate an admin account (sets status to `inactive`).

### PUT /activate/:username

Reactivate a deactivated admin account (sets status to `active`).

---

## Role Management

### POST /role/:name

Create a new role.

**Path params:**
- `name` -- Role name to create

Checks for uniqueness before creating.

### GET /role

Fetch all active roles.

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    { "name": "superAdmin", "status": "active" },
    { "name": "roomAdmin", "status": "active" },
    { "name": "foodAdmin", "status": "active" }
  ]
}
```

### DELETE /role/:name

Delete a role.
