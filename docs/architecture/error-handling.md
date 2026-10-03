# Error Handling

## Error Response Format

All errors return a consistent JSON structure:

```json
{
  "statusCode": 400,
  "message": "Human-readable error description",
  "data": "Stack trace (dev) or additional error context"
}
```

- `statusCode` -- HTTP status code (400, 401, 404, 500, etc.)
- `message` -- Error description string
- `data` -- Either the error stack trace or a custom data payload passed to `ApiError`

## ApiError Class

**File:** `utils/ApiError.js`

Custom error class used throughout the application:

```javascript
class ApiError extends Error {
  constructor(statusCode, message, data) {
    super();
    this.statusCode = statusCode;
    this.message = message;
    if (data) {
      this.data = data;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
```

Usage in controllers and helpers:

```javascript
throw new ApiError(404, 'Booking not found');
throw new ApiError(400, 'Invalid date');
throw new ApiError(401, 'Unauthorized');
throw new ApiError(400, 'Validation errors', validationDetails);
```

When `data` is provided as the third argument, it replaces the stack trace in the response. This is used to pass structured error details back to the client.

## CatchAsync Wrapper

**File:** `utils/CatchAsync.js`

Every controller function is wrapped with `CatchAsync` at the route level:

```javascript
router.get('/bookings', CatchAsync(FetchBookings));
```

`CatchAsync` does two things:

1. Catches any rejected promise from the async controller function
2. If `req.transaction` exists, rolls it back before passing the error to the next middleware

```javascript
const catchAsync = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(async (err) => {
    if (req.transaction) {
      await req.transaction.rollback();
    }
    next(err);
  });
};
```

This means controllers do not need explicit try/catch blocks for error handling. Throwing an `ApiError` or any other error anywhere in the call chain will be caught and routed to the error handler.

## ErrorHandler Middleware

**File:** `middleware/Error.js`

The global error handler is registered last in the Express middleware chain:

```javascript
app.use(ErrorHandler);
```

It processes all errors using the request's correlated logger when available:

```javascript
export const ErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Something went wrong';
  const data = err.data || err.stack;
  const log = req.log || logger; // Uses req.log (with correlationId) if available

  if (statusCode >= 500) {
    log.error('unhandled_error', { statusCode, message, stack: err.stack });
  } else if (statusCode >= 400) {
    log.warn('client_error', { statusCode, message });
  }

  return res.status(statusCode).json({ statusCode, message, data });
};
```

Key behaviors:

- Defaults to 500 if no `statusCode` is set on the error
- Uses `req.log` (which carries `correlationId` and `userId`) when available, falls back to root logger
- 5xx errors are logged as `error` level with the structured key `unhandled_error` (includes stack trace in the log)
- 4xx errors are logged as `warn` level with the structured key `client_error` (no stack trace in the log)
- Returns the stack trace in the `data` field of the HTTP response for unhandled errors

> TODO (NEEDS FIX): The error handler sends `err.stack` to clients for errors without a custom `data` field. In production, this exposes internal file paths and code structure. Consider suppressing stack traces for non-development environments.

## Predefined Error Messages

Common error messages are defined as constants in `config/constants.js`, for example:

| Constant                   | Message                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `ERR_CARD_NOT_PROVIDED`    | `"Cardno not provided"`                                       |
| `ERR_CARD_NOT_FOUND`       | `"User not found"`                                            |
| `ERR_INVALID_BOOKING_TYPE` | `"Invalid booking type"`                                      |
| `ERR_INVALID_DATE`         | `"Invalid date"`                                              |
| `ERR_BLOCKED_DATES`        | `"Dates are blocked"`                                         |
| `ERR_FEEDBACK_NOT_ALLOWED` | `"You are not eligible to submit feedback for this adhyayan"` |
| ...                        | ...                                                           |

## 404 Handler

Unmatched routes are caught by a fallback handler registered after all routes in `app.js`:

```javascript
app.use((_req, _res) => {
  throw new ApiError(404, 'Page Not Found');
});
```

This throws an `ApiError` that is then processed by the `ErrorHandler` middleware.

## Validation Errors

The project does not use a schema validation library (no Joi, Yup, or express-validator). Validation is performed manually in controllers and helpers:

```javascript
// Typical manual validation pattern
if (!cardno) throw new ApiError(404, ERR_CARD_NOT_PROVIDED);
if (!booking) throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
if (booking.status === STATUS_CANCELLED)
  throw new ApiError(400, ERR_BOOKING_ALREADY_CANCELLED);
```

> NOTE: We are considering using `zod` for validation in future releases!

## Sequelize Errors

Sequelize errors (validation failures, unique constraint violations, connection errors) are not explicitly caught or transformed into `ApiError` instances. They fall through to the `ErrorHandler` with a 500 status code and the raw Sequelize error message. The database connection configuration includes retry logic for connection-level errors.

## Transaction Rollback

When a controller creates a transaction and attaches it to `req.transaction`, the `CatchAsync` wrapper handles rollback automatically on error. A `warn`-level message (`Transaction rolled back for METHOD /path`) is logged via the root logger during rollback. For controllers that create local transactions (not attached to `req`), rollback must be handled manually in a try/catch block or in a `.catch()` chain.

## Error Logging and Correlation

Errors logged by the `ErrorHandler` carry the full request context when `req.log` is available:

- `correlationId` -- Links the error to the originating request
- `userId` -- Identifies the authenticated user (added after auth middleware)
- `method` and `path` -- The HTTP method and URL

This means a single `correlationId` filter in the log aggregation platform will surface the `request_received` entry, all business logic log entries, the error, and the `request_completed` entry for any failed request.
