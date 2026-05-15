# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aashray Backend is a Node.js/Express REST API for managing bookings and operations at a spiritual/residential center. It handles room, food, travel, event, and educational program bookings with Razorpay payment integration.

## Commands

```bash
npm run dev          # Development mode with nodemon
npm run start:prod   # Production mode (NODE_ENV=prod)
npm run start:cron   # Run background cron jobs separately
npm test             # Run all Jest tests
npm run logs:clean   # Clear all log files
```

Run a single test file:
```bash
npx jest tests/controllers/roomBooking.test.js
```

Run database migrations:
```bash
npx sequelize-cli db:migrate --env dev
npx sequelize-cli db:migrate:undo --env dev
```

## Environment Setup

Copy `.env.example` to `.env.dev` (or `.env.test`, `.env.qa`, `.env.prod`). The app loads the env file corresponding to `NODE_ENV` via `config/environment.js`.

Required variables: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `SECRET` (JWT), `SESSION_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, AWS S3 keys, SES SMTP config.

## Architecture

**ES Modules**: The project uses `"type": "module"` — all imports/exports use ES module syntax.

### Request Lifecycle

1. Request hits `app.js` → Logger middleware assigns a `correlationId` (UUID) and creates a child logger attached to `req.log`
2. Route-specific middleware runs (auth, validation)
3. After auth, `attachUserContext(req, userId)` adds userId to the child logger
4. Controller calls `catchAsync()` wrapper → helper functions for business logic → Sequelize transactions
5. On error: `CatchAsync` auto-rolls back `req.transaction` and passes error to `ErrorHandler` middleware

### Layers

- **Routes** (`routes/`): Define endpoints, apply middleware chains, call controllers
- **Controllers** (`controllers/`): Handle HTTP layer, parse params, call helpers, return responses. Split into `admin/` and `client/` subdirectories
- **Helpers** (`helpers/`): Business logic (booking creation, validation, waitlist management, pricing). Each domain has its own helper file
- **Models** (`models/`): Sequelize model definitions. `models/associations.js` defines all cross-model relationships
- **Utils**: `CatchAsync.js` wraps async handlers; `ApiError.js` is the custom error class

### Booking Domain

Each booking type (room, food, travel, adhyayan/educational programs, utsav/events) follows the same pattern:
- Model in `models/` with status tracking
- Helper in `helpers/` containing booking logic
- Controller in `controllers/client/` or `controllers/admin/`
- Status flow: `waiting` → `payment_pending` → `confirmed` → `cancelled`

All booking status values and prices are centralized in `config/constants.js` — always use these exported constants, never hardcode strings.

### Transactions

Most write operations begin a Sequelize transaction stored on `req.transaction`. This is automatically rolled back by `CatchAsync` on error. Pass `{ transaction: req.transaction }` to all Sequelize calls within a request.

### Logging

Use `req.log` (the request-scoped child logger with correlationId) in controllers and helpers, not the root `logger`. Call `attachUserContext(req)` immediately after authenticating a user to add userId to all subsequent log entries for that request. It reads `req.user` automatically.

```js
// After auth:
attachUserContext(req);
req.log.info('processing_booking', { bookingType, amount });
```

### Cron Jobs

`cron.js` runs separately from the main API server (`npm run start:cron`). It handles payment timeouts, waitlist promotion, and refunds on a 30-minute schedule.

### Payment Flow

Razorpay integration: client creates order → Razorpay redirects to webhook → webhook handler confirms booking and updates transaction records in `transactions` table. Cash payments and internal credit system are also supported.
