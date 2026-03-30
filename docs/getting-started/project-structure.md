# Project Structure

## Top-Level Layout

```
aashray-backend/
├── app.js                    # Express server entry point
├── cron.js                   # Scheduled task worker (runs as separate PM2 process)
├── package.json              # Dependencies and scripts (ES module project)
├── babel.config.cjs          # Babel config for Jest (CJS format for compatibility)
├── jest.config.cjs           # Jest test runner configuration
├── .prettierrc.json          # Prettier formatting rules
├── .gitignore
│
├── config/                   # Application configuration
│   ├── environment.js        # Loads .env.{NODE_ENV} via dotenv
│   ├── database.js           # Sequelize MySQL connection with pool config
│   ├── logger.js             # Winston logger setup (console + daily rotating files)
│   ├── constants.js          # All application constants (statuses, prices, roles, errors)
│   └── config.js             # Sequelize CLI config (used by migrations)
│
├── routes/                   # Express route definitions
│   ├── client/               # 15 route files for mobile app endpoints
│   ├── admin/                # 16 route files for admin website endpoints
│   └── wifi/                 # 1 route file for WiFi client endpoints
│
├── controllers/              # Request handlers (business logic)
│   ├── client/               # 13 controller files for client routes
│   ├── admin/                # 17 controller files for admin routes
│   └── wifi/                 # 1 controller file for WiFi routes
│
├── models/                   # Sequelize model definitions
│   ├── *.model.js            # 39 model files (one per database table)
│   ├── associations.js       # All model relationships (FK, cascades)
│   └── index.js              # Auto-loads models and runs associations
│
├── middleware/               # Express middleware
│   ├── AdminAuth.js          # JWT auth + role-based authorization
│   ├── validate.js           # Card validation (client auth)
│   ├── Error.js              # Global error handler
│   └── Logger.js             # HTTP logger: correlationId, req.log child logger, redaction
│
├── helpers/                  # Domain-specific business logic
│   ├── roomBooking.helper.js
│   ├── foodBooking.helper.js
│   ├── travelBooking.helper.js
│   ├── adhyayanBooking.helper.js
│   ├── utsavBooking.helper.js
│   ├── booking.helper.js     # Generic booking utilities
│   ├── transactions.helper.js # Payment/credit operations
│   ├── card.helper.js        # User card validation
│   ├── mailer.helper.js      # Email sending orchestration
│   └── notification.helper.js # Push notification wrappers
│
├── services/                 # External service integrations
│   └── notification.service.js # Expo push notification service (rate limiting, batching)
│
├── utils/                    # Low-level utilities
│   ├── ApiError.js           # Custom error class with statusCode
│   ├── CatchAsync.js         # Async error wrapper with transaction rollback
│   ├── sendMail.js           # Nodemailer + Handlebars email transport
│   ├── getDates.js           # Date range generation
│   └── connectionMonitor.js  # DB connection pool health monitoring
│
├── emails/                   # Handlebars email templates (.hbs)
│   ├── unifiedBookingEmail.hbs
│   ├── unifiedCancellationEmail.hbs
│   ├── forgotPasswordEmail.hbs
│   ├── styles.hbs            # Shared CSS styles
│   ├── _footer.hbs           # Shared footer partial
│   └── ... (14 templates total)
│
├── migrations/               # Sequelize migration files
│   └── YYYYMMDDHHMMSS-description.js
│
├── seeders/                  # Sequelize seed files (empty, unused)
│
├── tests/                    # Jest test suite
│   ├── app.test.js           # Integration tests
│   ├── testConstants.js      # Test configuration
│   ├── *Factory.js           # Test data factories
│   ├── controllers/          # Controller-level tests
│   ├── services/             # Service-level tests
│   ├── helpers/              # Test helper utilities
│   └── scripts/              # Ad-hoc test scripts
│
├── jest/                     # Jest lifecycle hooks
│   ├── globalSetup.js        # DB sync, truncate, seed before tests
│   └── globalTeardown.js     # Cleanup after tests
│
├── logs/                     # Winston log output (gitignored, created at runtime)
├── coverage/                 # Jest coverage reports (gitignored)
│
├── .github/workflows/
│   └── node.js.yml           # CI/CD: push to main -> deploy via PM2
│
└── .env.dev / .env.qa / .env.prod / .env.test  # Environment configs (gitignored)
```

## Request Lifecycle

A request flows through the following layers:

```
Client Request
     |
     v
Express Middleware Stack
  1. urlencoded + json (body parsing)
  2. cors
  3. httpLogger (middleware/Logger.js)
     - Assigns correlationId (from X-Request-Id header or random hex)
     - Sets req.correlationId, res header X-Request-Id
     - Creates req.log = logger.child({ correlationId, method, path })
     - Logs request_received { body (sanitized), ip, userAgent }
  4. express-session
     |
     v
Route Matching (app.js route mounts)
  e.g., /api/v1/food/* -> foodRoutes
     |
     v
Route-Level Middleware
  - Client routes: validateCard (extracts cardno, loads user from DB, sets req.user)
  - Admin routes: auth (verifies JWT) -> authorizeRoles(...) (checks role membership)
  - After auth: attachUserContext() adds userId to req.log child logger
     |
     v
Controller Function (wrapped in CatchAsync)
  - Uses req.log for all logging (carries correlationId + userId automatically)
  - Reads req.body / req.params / req.query
  - Calls helpers for business logic (passes req.log as parameter)
  - Calls models for DB operations
  - Optionally uses a Sequelize transaction (req.transaction or local)
  - Returns res.status(200).json({ message, data })
     |
     v
Response Sent
  - res.send() intercept logs request_completed { statusCode, durationMs }
  - Response body logged only for errors (status >= 400), truncated to 500 chars
     |
     v
Error Path (if controller throws):
  CatchAsync catches -> rolls back transaction if present -> passes to next(err)
     |
     v
ErrorHandler Middleware
  - Uses req.log if available, falls back to root logger
  - 5xx: error level, key unhandled_error, includes stack trace
  - 4xx: warn level, key client_error, no stack trace
  - Returns JSON: { statusCode, message, data }
     |
     v
404 Handler (if no route matched)
  - Throws ApiError(404, 'Page Not Found')
  - Caught by ErrorHandler
```

## Key Architectural Patterns

### Controllers vs Helpers

Controllers handle HTTP concerns (parsing request, sending response). Helpers contain reusable business logic that may be called from multiple controllers or from the cron job. For example, `adhyayanBooking.helper.js` contains booking logic used by both the client controller and the cron cancellation job.

### Transaction Management

Database transactions are created at the controller level and passed through to helpers. If an error occurs, `CatchAsync` automatically rolls back any transaction attached to `req.transaction`. Some controllers create local transactions instead of attaching to `req`.

### Dual Route Structure

Routes are split into `client/` and `admin/` directories. Client routes use card-based authentication (`validateCard` middleware). Admin routes use JWT authentication (`auth` + `authorizeRoles` middleware). Both can operate on the same underlying data.

### Cron as Separate Process

The cron worker (`cron.js`) runs as an independent PM2 process, not inside the Express server. It shares the same models, helpers, and database connection. It handles automated cancellation of unpaid bookings and waitlist promotions.

### Model Associations Centralized

All Sequelize model relationships are defined in `models/associations.js` rather than inside individual model files. This prevents circular dependency issues and keeps relationships in one place.
