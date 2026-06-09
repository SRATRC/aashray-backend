# Architecture Overview

## What This Backend Does

Aashray Backend is a facility management system for Research Centre. It handles:

- **Accommodation** -- Room and flat booking with check-in/check-out tracking
- **Food** -- Meal booking, plate issuance, bulk food orders, menu management
- **Travel** -- Transport booking between locations (e.g., Mumbai to Research Centre)
- **Adhyayan** -- Study/retreat program registration, attendance tracking, feedback collection
- **Utsav** -- Festival/event booking with package selection
- **Payments** -- Online payments via Razorpay, cash tracking, credit system
- **Gate management** -- Entry/exit recording for on-premise tracking
- **Maintenance** -- Facility maintenance request submission and tracking
- **WiFi** -- Temporary and permanent WiFi code generation and distribution
- **User management** -- Card-based identity, guest registration, admin role management

## System Components

The backend runs as two PM2 processes:

1. **BackendAPI** (`app.js`) -- The Express HTTP server handling all API requests
2. **CronJob** (`cron.js`) -- A scheduled worker running every 30 minutes for automated tasks

Both processes share the same codebase, models, and database connection.

## External Service Integrations

### Razorpay (Payment Gateway)

- Order creation for pending transactions
- Webhook receiver for payment status updates (captured, failed, authorized)
- Settlement tracking and reconciliation via Excel upload
- All webhook events logged to `razorpay_webhook` table for audit

### AWS S3 (File Storage)

- Profile picture uploads via `multer` + `multer-s3`
- Files stored at path `{cardno}/{timestamp}-{filename}`
- Public URL returned to client after upload

### AWS SES (Email)

- SMTP transport via Nodemailer
- Handlebars templates for booking confirmations, cancellations, status updates, password resets
- Sender address configured via `SES_SMTP_EMAIL` env var

### Expo Push Notifications

- Push notifications to React Native mobile app
- Rate-limited to 600 messages/second with batch chunking
- Receipt tracking for delivery confirmation
- Handles `DeviceNotRegistered` errors by clearing invalid tokens

## Authentication and Authorization

The system uses two separate auth mechanisms for two client types:

### Client (Mobile App)

- Users are identified by `cardno` (a physical card number)
- `validateCard` middleware extracts `cardno` from request params/body/query
- Validates the card exists in the database and sets `req.user`
- No token-based session; each request includes the `cardno`
- Password verification happens only at login (`verifyAndLogin`)

### Admin (Website)

- JWT-based authentication via `Authorization: Bearer <token>` header
- `auth` middleware verifies the token, loads the admin user, fetches their roles
- `authorizeRoles(...roles)` middleware checks if the admin has at least one of the required roles
- 25+ distinct roles supporting granular, location-specific access control

See [Auth Flow](auth-flow.md) for the complete authentication and authorization flow.

## Database

MySQL via Sequelize ORM with 39 models. Key characteristics:

- Connection pooling: 3-25 connections with auto-eviction and retry logic
- Connection pool warm-up on server start
- SSL support for QA environment
- Migrations managed via Sequelize CLI
- `sequelize.sync()` runs on startup to create missing tables
- Soft deletes via status fields (not Sequelize `paranoid`)

## Cron Worker

The cron job (`cron.js`) runs every 30 minutes and handles:

1. **Cancel unpaid bookings** -- Finds transactions in `pending` status older than 24 hours and cancels associated bookings
2. **Release waiting list spots** -- When a booking is cancelled, promotes the next person on the waiting list:
   - Adhyayan: moves waiting to confirmed, creates attendance entry
   - Utsav: opens up the seat
   - Travel: moves waiting to awaiting confirmation
3. **Cancel associated meals** -- Cancels food bookings tied to cancelled room/event bookings
4. **Send notifications** -- Emails cancellation notices and booking confirmations to affected users

The cron worker uses database transactions with rollback on error and supports graceful shutdown (waits for in-progress job to complete before exiting).

## Key Technology Choices

| Choice                     | Rationale                                                                     |
| -------------------------- | ----------------------------------------------------------------------------- |
| ES modules                 | Modern import/export syntax; `"type": "module"` in package.json               |
| Sequelize 6                | ORM with migration support, model associations, transaction management        |
| Winston + daily rotate     | Structured JSON logging with correlation IDs, file rotation, and retention    |
| Handlebars email templates | Logic-less templates for consistent email formatting                          |
| `uuid` for booking IDs     | Globally unique booking identifiers across all booking types                  |
| `moment-timezone`          | Timezone-aware date handling (IST-specific business rules)                    |
| `xlsx` library             | Excel file parsing for bulk admin operations (WiFi codes, settlements, menus) |

## Logging

The logging system uses Winston with daily-rotate-file transports to produce structured JSON output. It is designed for ingestion by log aggregation platforms (e.g., New Relic).

### Correlation IDs

Every HTTP request is assigned a `correlationId` (from the `X-Request-Id` header or a random 6-byte hex). The `httpLogger` middleware (`middleware/Logger.js`) creates a child logger at `req.log` carrying this ID. After authentication, `attachUserContext()` adds `userId` to the child logger. All log entries for a single request can then be filtered by a single `correlationId`.

### Log Levels

Custom levels in priority order:

| Level   | Priority | Active in            |
| ------- | -------- | -------------------- |
| `error` | 0        | All environments     |
| `warn`  | 1        | All environments     |
| `info`  | 2        | All environments     |
| `http`  | 3        | dev / test / qa only |
| `debug` | 4        | dev / test / qa only |

In production (`NODE_ENV=prod`), the level gate is `info` -- `debug` and `http` entries are suppressed.

### Transports and File Configuration

| Transport  | File Pattern                           | Level                 | Details                                       |
| ---------- | -------------------------------------- | --------------------- | --------------------------------------------- |
| Main file  | `{LOG_DIR}/application-YYYY-MM-DD.log` | Inherits logger level | All levels, 20 MB max, 90-day retention, gzip |
| Error file | `{LOG_DIR}/error-YYYY-MM-DD.log`       | `error` only          | 20 MB max, 90-day retention, gzip             |
| Console    | stdout                                 | Inherits logger level | Colorized, human-readable                     |

`LOG_DIR` defaults to `/home/ubuntu/logs`. Override with the `LOG_DIR` environment variable. In local development, `app.js` creates a `./logs` directory if the configured path does not exist.

### Structured Log Format

File transports write structured JSON. Every top-level key becomes a queryable attribute:

```json
{
  "level": "info",
  "message": "room_booking_confirmed",
  "correlationId": "a3f8c1",
  "userId": "MM1234",
  "method": "POST",
  "path": "/api/client/room/book",
  "bookingid": 42,
  "amount": 500,
  "timestamp": "2026-03-16T08:30:00.000Z"
}
```

Console transport uses a human-readable format:

```
2026-03-16 08:30:00 info [reqId=a3f8c1] [user=MM1234]: room_booking_confirmed {"bookingid":42,"amount":500}
```

### Sensitive Field Redaction

`middleware/Logger.js` sanitizes `req.body` before logging the `request_received` event. The following fields are replaced with `[REDACTED]`:

- `password`
- `token`
- `secret`
- `otp`
- `pin`

Response bodies are truncated at 500 characters.

### Structured Message Keys

All log messages use snake_case event keys (e.g., `room_booking_confirmed`, `adhyayan_seat_reserved`) rather than free-form strings. Key domains include:

| Domain       | Example Keys                                                                     |
| ------------ | -------------------------------------------------------------------------------- |
| HTTP         | `request_received`, `request_completed`                                          |
| Auth         | `admin_login_success`, `admin_login_failed`, `admin_created`                     |
| Room         | `room_booking_start`, `room_booking_result`, `room_assigned`                     |
| Adhyayan     | `adhyayan_booking_start`, `adhyayan_seat_reserved`, `adhyayan_waitlist_promoted` |
| Food         | `food_booking_start`, `food_booking_result`, `food_plate_issued`                 |
| Travel       | `travel_booking_start`, `travel_waiting_booking_promoted`                        |
| Transactions | `cancel_transaction`, `credit_added`, `credit_used`                              |
| Email        | `email_sent`, `email_send_failed`                                                |
| Error        | `unhandled_error` (5xx), `client_error` (4xx)                                    |
| Cron         | `cron_job_failed`                                                                |

## Pricing Constants

Prices are hardcoded in `config/constants.js`:

| Item                    | Price (INR) |
| ----------------------- | ----------- |
| AC Room (per night)     | 1100        |
| Non-AC Room (per night) | 700         |
| Breakfast               | 60          |
| Lunch                   | 120         |
| Dinner                  | 120         |
