# Logging Reference

This document is the authoritative reference for the logging system in Aashray Backend. It covers architecture, usage patterns, message keys, and how to add logging to new code.

---

## 1. Overview

The logging system uses **Winston** with **daily-rotate-file** transports to produce structured JSON output suitable for ingestion by New Relic or any log aggregation platform. Every HTTP request gets a unique `correlationId` baked into a child logger attached to `req.log`, so all log entries for a single request can be filtered by a single ID. After authentication, `attachUserContext()` adds `userId` to that child logger so all subsequent entries also carry the user identity.

---

## 2. Architecture

### 2.1 Log Levels

Custom levels in priority order:

| Level | Priority | Active in |
|-------|----------|-----------|
| `error` | 0 | all envs |
| `warn` | 1 | all envs |
| `info` | 2 | all envs |
| `http` | 3 | dev / test / qa (reserved, unused currently) |
| `debug` | 4 | dev / test / qa only |

When `NODE_ENV=prod`, the level gate is set to `info` — `debug` and `http` entries are suppressed entirely. All other environments gate at `debug`.

### 2.2 Transports & File Configuration

| Transport | File Pattern | Level | Details |
|-----------|-------------|-------|---------|
| Main file | `{LOG_DIR}/application-YYYY-MM-DD.log` | inherits logger level | All levels, 20 MB max size, 90-day retention, gzip compressed |
| Error file | `{LOG_DIR}/error-YYYY-MM-DD.log` | `error` only | 20 MB max size, 90-day retention, gzip compressed |
| Console | stdout | inherits logger level | Colorized, human-readable |

`LOG_DIR` defaults to `/home/ubuntu/logs`. Override with the `LOG_DIR` environment variable. In local development, `app.js` creates a `./logs` directory if the configured path does not exist.

### 2.3 Log Formats

**File transports** write structured JSON. Every top-level key becomes a queryable attribute in New Relic:

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

**Console transport** uses a human-readable format:

```
2026-03-16 08:30:00 info [reqId=a3f8c1] [user=MM1234]: room_booking_confirmed {"bookingid":42,"amount":500}
```

---

## 3. Request Lifecycle & CorrelationId

```
1. Request arrives
   └── httpLogger middleware (middleware/Logger.js)
       ├── correlationId = X-Request-Id header OR random 6-byte hex
       ├── req.correlationId = correlationId
       ├── res.setHeader('X-Request-Id', correlationId)          ← client gets it back
       ├── req.log = logger.child({ correlationId, method, path })
       └── logs request_received { body (sanitized), ip, userAgent }

2. Route middleware runs (validation, etc.)

3. Auth middleware runs
   └── attachUserContext(req)
       └── req.log = req.log.child({ userId })                   ← userId joins all future entries

4. Controller / helpers execute
   └── req.log.info / warn / error / debug
       └── every entry automatically carries correlationId + userId

5. Response is sent
   └── res.send() intercept logs request_completed
       ├── statusCode, durationMs
       └── responseBody (truncated to 500 chars) — errors only (status >= 400)

6. On error
   └── catchAsync rolls back req.transaction → passes error to ErrorHandler
       └── ErrorHandler logs unhandled_error (5xx) or client_error (4xx)
           using req.log if available, falling back to root logger
```

---

## 4. How to Use the Logger

### 4.1 In Controllers

`req.log` is available on every request after `httpLogger` runs. Never import the root `logger` directly in a controller.

```js
// After auth, req.log already carries correlationId + userId
req.log.info('booking_confirmed', { bookingid, amount, cardno });
req.log.warn('validation_failed', { field: 'checkin', reason: 'past date' });
req.log.error('payment_gateway_error', { error: err.message });
req.log.debug('pricing_calculated', { base, discount, final });
```

### 4.2 Passing Context to Helpers

Pass `req.log` as the last argument when calling helpers from a controller so correlation context flows through the entire call chain.

```js
const result = await bookRoomHelper(bookingData, t, req.log);
```

### 4.3 In Helpers (accepting log param)

Add `log = logger` as the last/optional parameter. This ensures helpers work both from HTTP requests (with correlationId) and from cron/scripts (using root logger).

```js
import logger from '../config/logger.js';

export async function myHelper(arg1, arg2, t, log = logger) {
  log.info('my_helper_start', { arg1 });
  // pass log to nested helpers too
  await nestedHelper(x, t, log);
}
```

### 4.4 In Cron Jobs

Cron jobs run outside an HTTP request context — there is no `req.log`. Use the root `logger` directly.

```js
import logger from './config/logger.js';

logger.info('cron_job_started', { jobName: 'payment_timeout' });
logger.error('cron_job_failed', { error: err.message, stack: err.stack });
```

### 4.5 In sendMail

`sendMail` accepts an optional logger argument and defaults to the root logger.

```js
// From a controller or helper — passes correlationId through
await sendMail({ email, subject, template, context }, req.log);

// From cron — uses root logger
await sendMail({ email, subject, template, context });
```

---

## 5. Sensitive Field Redaction

`middleware/Logger.js` sanitizes `req.body` before logging the `request_received` event. The following fields are automatically replaced with `[REDACTED]`:

- `password`
- `token`
- `secret`
- `otp`
- `pin`

Response bodies are truncated at 500 characters with a `…[truncated]` suffix.

**Rule:** Never log raw passwords, tokens, OTPs, or PII. Use structured key-value fields rather than interpolated strings so individual keys can be filtered or redacted at the transport level.

---

## 6. Log Message Keys Reference

All structured message keys used across the codebase:

### HTTP / Framework

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `request_received` | info | HTTP | `body`, `ip`, `userAgent` |
| `request_completed` | info / warn / error | HTTP | `statusCode`, `durationMs`, `responseBody` (errors only) |
| `unhandled_error` | error | Error handler | `statusCode`, `message`, `stack` |
| `client_error` | warn | Error handler | `statusCode`, `message` |

### Auth

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `admin_login_success` | info | Auth | `username` |
| `admin_login_failed` | warn | Auth | `username`, `reason` |
| `admin_created` | info | Auth | `username`, `createdBy` |
| `admin_password_reset` | info | Auth | `username`, `resetBy` |

### Room Booking

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `room_booking_start` | info | Room | booking params |
| `room_booking_result` | info | Room | booking outcome |
| `room_booking_utsav_boundary_waiting` | debug | Room | boundary detail |
| `room_assigned` | debug | Room | room number, cardno |
| `flat_booking_start` | info | Room | booking params |

### Adhyayan Booking

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `adhyayan_booking_start` | info | Adhyayan | `shibir_ids`, `mumukshu_count`, `bookedBy` |
| `adhyayan_seat_reserved` | info | Adhyayan | `bookingid`, `cardno`, `shibir_id`, `status` |
| `adhyayan_seat_waiting` | info | Adhyayan | `bookingid`, `cardno`, `shibir_id` |
| `adhyayan_seat_decremented` | debug | Adhyayan | `shibir_id`, `remaining` |
| `adhyayan_waitlist_promoted` | info | Adhyayan | promoted booking detail |
| `adhyayan_seat_opened_no_waiting` | debug | Adhyayan | `shibir_id` |

### Food Booking

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `food_booking_start` | info | Food | `start_date`, `end_date`, `mumukshu_count`, `bookedBy` |
| `food_booking_result` | info | Food | `created`, `transactions`, `amount` |
| `food_plate_issued` | info | Food | plate detail |

### Travel Booking

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `travel_booking_start` | info | Travel | booking params |
| `travel_booking_result` | info | Travel | booking outcome |
| `travel_waiting_booking_promoted` | info | Travel | promoted booking detail |

### Utsav Booking

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `open_utsav_seat` | debug | Utsav | seat detail |

### Transactions / Credits

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `cancel_transaction` | debug | Transactions | `status`, `bookingid`, `admin` |
| `user_cancellation_no_credits` | debug | Transactions | `bookingid` |
| `credit_added` | info | Transactions | `cardno`, `bookingType`, `creditType`, `credits`, `previousCredits`, `newTotal` |
| `credit_used` | info | Transactions | `cardno`, `bookingType`, `creditType`, `creditsUsed`, `discountedAmount`, `bookingid` |
| `updating_razorpay_order_id` | info | Transactions | `bookingIds`, `transactionIds`, `razorpay_order_id`, `count` |

### Email

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `email_sent` | info | Email | `email`, `messageId` |
| `email_send_failed` | error | Email | `email`, `error` |
| `no_email_handler` | warn | Email | `bookingType`, `isArray` |

### Admin Operations

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `settlement_missing_date` | warn | Accounts | — |
| `settlement_invalid_date` | warn | Accounts | — |
| `invalid_credits_json` | warn | Accounts | — |
| `credit_match_candidate` | debug | Accounts | match detail |
| `credit_match_found` | debug | Accounts | match detail |
| `notification_send_failed` | error | Notifications | `err` |
| `deprecated_endpoint_called` | warn | Room | endpoint detail |
| `card_id_generation_switched_to_sequential` | warn | Cards | — |

### Cron

| Key | Level | Domain | Fields |
|-----|-------|--------|--------|
| `cron_job_failed` | error | Cron | `error`, `stack` |

---

## 7. Error Handling & Transaction Rollback

`utils/CatchAsync.js` wraps every async controller function. On any thrown error:

1. If `req.transaction` exists, it is rolled back immediately.
2. A `warn`-level message `Transaction rolled back for METHOD /path` is logged via the root logger.
3. The error is forwarded to `middleware/Error.js` via `next(err)`.

`middleware/Error.js` resolves the logger as `req.log || logger` (falls back to root if `httpLogger` did not run):

- **5xx errors** → `error` level, key `unhandled_error`, includes full stack trace.
- **4xx errors** → `warn` level, key `client_error`, no stack trace.

---

## 8. Adding Logging to New Code

Checklist when creating a new controller or helper:

- [ ] Controller function is wrapped in `catchAsync()`
- [ ] Use `req.log` in controllers — do **not** import the root `logger` in controller files
- [ ] Add `log = logger` as the last optional parameter in every helper function signature
- [ ] Pass `req.log` when calling helpers from a controller
- [ ] Pass `log` when calling nested helpers from helpers
- [ ] Log business events at `info`, internal flow steps at `debug`, recoverable problems at `warn`, unrecoverable failures at `error`
- [ ] Use **snake_case** event keys (e.g. `room_booking_confirmed`), not free-form strings (e.g. `"Room booking confirmed"`)
- [ ] Never log passwords, tokens, raw Sequelize model instances, or large arrays
- [ ] Never log the entire `req` or `res` objects
