# Aashray Backend

REST API backend for managing Research Centre operations, serving both mobile app and admin website.

## Tech Stack

| Layer              | Technology                                        |
| ------------------ | ------------------------------------------------- |
| Runtime            | Node.js 23.x (ES modules)                         |
| Framework          | Express 4.x                                       |
| Database           | MySQL via Sequelize 6.x ORM (Hosted - AWS Aurora) |
| Auth               | JWT (admin), card-based password auth (client)    |
| Payments           | Razorpay                                          |
| Email              | AWS SES via Nodemailer + Handlebars templates     |
| Push Notifications | Expo Server SDK                                   |
| File Storage       | AWS S3                                            |
| Process Manager    | PM2 (API server + cron worker)                    |
| CI/CD              | GitHub Actions on self-hosted runner              |
| Logging            | Winston with structured JSON, correlation IDs, daily file rotation |

## Documentation Index

### Getting Started

- [Setup](docs/getting-started/setup.md) -- Prerequisites, local install, environment variables, running the server
- [Project Structure](docs/getting-started/project-structure.md) -- Folder layout, request lifecycle, code organization
- [Conventions](docs/getting-started/conventions.md) -- Naming, formatting, logging, git workflow, code patterns

### Architecture

- [Overview](docs/architecture/overview.md) -- System architecture, external integrations, logging, high-level design
- [Database Schema](docs/architecture/database-schema.md) -- All models, fields, types, relationships, indexes
- [Auth Flow](docs/architecture/auth-flow.md) -- Client and admin authentication, JWT, role-based authorization
- [Error Handling](docs/architecture/error-handling.md) -- Error classes, response format, middleware chain, correlation
- [Booking Lifecycle](docs/architecture/booking-lifecycle.md) -- Status flows, payment states, credits, cancellation rules, waitlist promotion, cron automation

### API Reference

- [API Overview](docs/api/overview.md) -- Base URL, headers, response envelope, pagination
- **Endpoints:**
  - [Auth](docs/api/endpoints/auth.md) -- Client login/logout/password + admin login/create/reset
  - [Rooms](docs/api/endpoints/rooms.md) -- Client room/flat booking + admin room/flat management and reports
  - [Food](docs/api/endpoints/food.md) -- Client meal booking + admin plate issuance, menus, reports
  - [Travel](docs/api/endpoints/travel.md) -- Client travel booking + admin management and driver manifest
  - [Adhyayan](docs/api/endpoints/adhyayan.md) -- Client registration/feedback + admin CRUD, attendance, reports
  - [Utsav](docs/api/endpoints/utsav.md) -- Client event booking + admin packages, check-in, reports
  - [Bookings](docs/api/endpoints/bookings.md) -- Unified guest/mumukshu booking + admin cancellation
  - [Payment](docs/api/endpoints/payment.md) -- Razorpay order creation and webhook
  - [Profile](docs/api/endpoints/profile.md) -- User profile, transactions, notifications
  - [Gate](docs/api/endpoints/gate.md) -- Admin gate entry/exit tracking and history
  - [Cards](docs/api/endpoints/cards.md) -- Admin user card CRUD
  - [Accounts](docs/api/endpoints/accounts.md) -- Admin financial management and settlement reconciliation
  - [WiFi](docs/api/endpoints/wifi.md) -- Client/admin WiFi code management
  - [Admin Controls](docs/api/endpoints/admin-controls.md) -- Super admin role and user management
  - [Maintenance](docs/api/endpoints/maintenance.md) -- Client/admin maintenance requests
  - [Support](docs/api/endpoints/support.md) -- Support ticket creation
  - [Location](docs/api/endpoints/location.md) -- Countries, states, cities, centres
  - [Updates](docs/api/endpoints/updates.md) -- App version checking

### Guides

- [Adding a New Endpoint](docs/guides/adding-a-new-endpoint.md) -- Step-by-step walkthrough
- [Database Migrations](docs/guides/database-migrations.md) -- Creating, running, and rolling back migrations
- [Testing](docs/guides/testing.md) -- Current state of test infrastructure
- [Deployment](docs/guides/deployment.md) -- CI/CD pipeline, PM2, production setup, logging
- [Environment Config](docs/guides/environment-config.md) -- All configuration values and per-environment differences

### Architecture Decision Records

- [ADR-001: India-Only Payment Cancellation](docs/adr/001-india-only-payment-cancellation.md) -- Why cron only auto-cancels unpaid bookings for India-based users
- [ADR-002: Credit System Design](docs/adr/002-credit-system-design.md) -- JSON-based credit storage, type segregation, flat/room interchangeability, no-refund rules for travel/utsav
- [ADR-003: Room Allocation and Gender Encoding](docs/adr/003-room-allocation-and-gender-encoding.md) -- Floor+gender concatenation (SCM/SCF), WL rooms, day visits, utsav boundary waiting
- [ADR-004: Samvatsari Package Exclusivity](docs/adr/004-samvatsari-package-exclusivity.md) -- Hardcoded mutual exclusivity between package IDs 21, 18, and 20
- [ADR-005: Gate Entry Async Side Effects](docs/adr/005-gate-entry-async-side-effects.md) -- Booking status updates run after HTTP response via res.on('finish')
- [ADR-006: Food Booking Requires Accommodation](docs/adr/006-food-booking-requires-accommodation.md) -- Meal booking tied to room/flat/adhyayan enrollment, utsav date exclusion
- [ADR-007: Late Checkout Fee as Orphan Transaction](docs/adr/007-late-checkout-fee-as-orphan-transaction.md) -- Standalone transactions with no booking row, fee schedule, disabled overstay handling
- [ADR-008: DataChef Migration Compatibility](docs/adr/008-datachef-migration-compatibility.md) -- Runtime detection of legacy records via booking ID length heuristic
- [ADR-009: Adhyayan Attendance and Feedback Windows](docs/adr/009-adhyayan-attendance-and-feedback-windows.md) -- Pre-created attendance (default attended), Research Centre only, feedback from start_date not end_date
- [ADR-010: Travel Directional Conflict and Waitlist](docs/adr/010-travel-directional-conflict-and-waitlist.md) -- Same-direction duplicate prevention, FIFO waitlist promotion to awaiting confirmation, utsav waitlist not auto-promoted
- [ADR-011: WiFi Username Generation](docs/adr/011-wifi-username-generation.md) -- Name prefix stripping, card+device suffix, collision counter, dry-run pattern
- [ADR-012: UtsavBooking hasOne Relationship](docs/adr/012-utsav-booking-has-one-relationship.md) -- Likely bug: should be hasMany, silently returns only one booking via eager loading

## System Context

This backend is one part of a three-component system:

```
+-------------------+     +-------------------+     +-------------------+
|  React Native     |     |  Admin Website    |     |  Cron Worker      |
|  Mobile App       |     |  (Vanilla JS)     |     |  (node cron.js)   |
|                   |     |                   |     |                   |
|  Client routes    |     |  Admin routes     |     |  Scheduled jobs   |
|  /api/v1/client/* |     |  /api/v1/admin/*  |     |  Every 30 min     |
+--------+----------+     +--------+----------+     +--------+----------+
         |                         |                         |
         +-------------------------+-------------------------+
                                   |
                          +--------v----------+
                          |  Aashray Backend  |
                          |  (this repo)      |
                          +--------+----------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
     +--------v-------+  +--------v-------+  +--------v-------+
     |  MySQL DB      |  |  AWS (S3/SES)  |  |  Razorpay      |
     +----------------+  +----------------+  +----------------+
```

The mobile app uses client routes with card-based authentication. The admin website uses admin routes with JWT-based authentication. Both hit the same Express server. The cron worker runs as a separate PM2 process handling automated booking cancellations and waitlist promotions.
