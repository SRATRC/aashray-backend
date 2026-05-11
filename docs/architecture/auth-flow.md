# Authentication and Authorization Flow

This system uses two completely separate authentication mechanisms: one for mobile app users (card-based) and one for admin website users (JWT-based).

## Client Authentication (Mobile App)

### Identity Model

Mobile app users are identified by a `cardno` (card number) tied to a physical card. The `card_db` table stores user profiles including `password`, `mobno` (mobile number), `status`, and `res_status` (resident type).

### Login Flow

**Endpoint:** `POST /api/v1/client/verifyAndLogin`

```
Client sends: { mobno, password }
     |
     v
Controller looks up CardDb by mobno
     |
     v
Compares password with bcrypt hash
     |
     v
Returns user data: { cardno, issuedto, isFlatOwner, password: "" }
```

There is no token returned. The client stores the `cardno` locally and sends it with every subsequent request.

### Per-Request Authentication

Every client route (except login, forgot password, location, and updates) uses the `validateCard` middleware:

```javascript
// middleware/validate.js
const cardno = req.params.cardno || req.body.cardno || req.query.cardno;
const cardData = await CardDb.findOne({ where: { cardno } });
if (!cardData) throw new ApiError(404, 'User not found');
req.user = cardData;
```

The middleware:

1. Extracts `cardno` from params, body, or query (in that priority order)
2. Looks up the card in the database
3. Throws 404 if not found
4. Attaches the full card record to `req.user`

> TODO (NEEDS FIX ⚠️): This means any valid `cardno` can make requests on behalf of that user. There is no per-request token or session validation beyond the initial login password check.

### Password Management

- **Update password:** `POST /api/v1/client/updatePassword` -- requires old password, hashes new password with bcrypt
- **Forgot password:** `POST /api/v1/client/forgotPassword` -- generates a random 5-character temporary password, hashes it, emails it to the user
- **Logout:** `GET /api/v1/client/logout` -- clears the `token` field on the card record

### User Types

Users have a `res_status` field determining their type:

- `PR` -- Permanent Resident
- `MUMUKSHU` -- Monastic resident (can book flats)
- `SEVA KUTIR` -- Service volunteer
- `GUEST` -- Guest (created and linked to a primary card holder)

These types affect which bookings are available and which validation rules apply.

---

## Admin Authentication (Website)

### Login Flow

**Endpoint:** `POST /api/v1/admin/auth/login`

```
Admin sends: { username, password }
     |
     v
Controller looks up AdminUsers by username
     |
     v
Compares password with bcrypt hash
     |
     v
Fetches active roles from AdminRoles table
     |
     v
Signs JWT with { user: { id, username } }
     |
     v
Returns: { token, roles: ["superAdmin", "roomAdmin", ...] }
```

The JWT is signed using the `SECRET` environment variable with no explicit expiration set in the code (defaults to no expiry unless configured).

### Per-Request Authentication

Admin routes use the `auth` middleware followed by `authorizeRoles`:

```javascript
// middleware/AdminAuth.js

// Step 1: auth middleware
const token = header.replace('Bearer ', '');
const decoded = jwt.verify(token, process.env.SECRET);
const user = await AdminUsers.findOne({ where: { id, username } });
if (user.status === 'inactive') throw new ApiError(401, 'Account Deactivated');
const roles = await AdminRoles.findAll({
  where: { user_id, status: 'active' }
});
req.user = decoded.user;
req.roles = roles.map((r) => r.role_name);

// Step 2: authorizeRoles middleware (per route)
const isAuthorized = requiredRoles.some((role) => userRoles.includes(role));
if (!isAuthorized) throw new ApiError(401, 'Unauthorized');
```

### Authorization Model

The system uses a role-based access control (RBAC) model:

- **AdminUsers** table stores admin accounts (username, hashed password, status)
- **Roles** table stores role definitions
- **AdminRoles** join table maps users to roles (many-to-many, with status)

Each admin route specifies which roles can access it. A user needs at least one matching role.

### Role Definitions

| Role                    | Access                           |
| ----------------------- | -------------------------------- |
| `superAdmin`            | Full system access, all routes   |
| `roomAdmin`             | Room booking management          |
| `officeAdmin`           | Office operations (rooms, cards) |
| `cardAdmin`             | User card CRUD                   |
| `foodAdmin`             | Food booking and menu management |
| `travelAdmin`           | Travel booking management        |
| `travelAdminDri`        | Travel admin for Dri location    |
| `adhyayanAdmin`         | Adhyayan program management      |
| `adhyayanAdminKol`      | Adhyayan admin for Kol location  |
| `adhyayanAdminRaj`      | Adhyayan admin for Raj location  |
| `adhyayanAdminDhu`      | Adhyayan admin for Dhu location  |
| `adhyayanAdminReadOnly` | Read-only adhyayan access        |
| `utsavAdmin`            | Utsav event management           |
| `utsavAdminRaj`         | Utsav admin for Raj location     |
| `utsavAdminReadOnly`    | Read-only utsav access           |
| `accountsAdmin`         | Financial transaction management |
| `accountsAdminPra`      | Accounts admin for Pra location  |
| `gateAdmin`             | Gate entry/exit management       |
| `maintenanceAdmin`      | Maintenance request handling     |
| `housekeepingAdmin`     | Housekeeping maintenance         |
| `electricalAdmin`       | Electrical maintenance           |
| `avtAdmin`              | Audio-visual tech management     |
| `wifiAdmin`             | WiFi code management             |
| `smilesAdmin`           | Smilestones food program         |

Some roles are location-specific (e.g., `adhyayanAdminKol` for Kolkata, `travelAdminDri` for Dri). These allow the same admin features but scoped to a specific centre.

### Admin Account Management

- **Create admin:** `POST /api/v1/admin/auth/create` -- superAdmin only, sets initial roles
- **Reset password:** `POST /api/v1/admin/auth/reset-password` -- no auth required (self-service)
- **Deactivate admin:** `PUT /api/v1/admin/sudo/deactivate/:username` -- superAdmin only
- **Activate admin:** `PUT /api/v1/admin/sudo/activate/:username` -- superAdmin only
- **Update roles:** `PUT /api/v1/admin/sudo/update_roles` -- superAdmin only

---

## Differences Between Client and Admin Auth

| Aspect           | Client (Mobile)                            | Admin (Website)             |
| ---------------- | ------------------------------------------ | --------------------------- |
| Identity         | Card number (`cardno`)                     | Username                    |
| Auth mechanism   | Password at login, then cardno per request | JWT Bearer token            |
| Token storage    | No token used for requests                 | JWT in Authorization header |
| Session          | Stateless (cardno in each request)         | Stateless (JWT)             |
| Authorization    | By `res_status` (user type)                | By roles (RBAC)             |
| Middleware       | `validateCard`                             | `auth` + `authorizeRoles`   |
| Password hashing | bcrypt                                     | bcrypt                      |

---

## Public Endpoints (No Auth Required)

These routes require no authentication:

- `GET /api` -- API status check
- `GET /api/health` -- Health check with DB pool status
- `GET /api/v1/updates` -- App version check
- `GET /api/v1/location/*` -- Country/state/city/centre data
- `POST /api/v1/client/verifyAndLogin` -- Login
- `POST /api/v1/client/forgotPassword` -- Password reset
- `POST /api/v1/admin/auth/login` -- Admin login
- `POST /api/v1/admin/auth/reset-password` -- Admin password reset
- `POST /api/v1/admin/utsav/utsavCheckin` -- Utsav check-in (public kiosk)
- `POST /api/v1/admin/utsav/issue/:cardno` -- Utsav plate issuance (public kiosk)
- `POST /api/v1/razorpay/verifyPayment` -- Razorpay webhook (verified by webhook secret)
