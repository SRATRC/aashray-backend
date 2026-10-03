# Testing

## UNDER CONSTRUCTION 🚧

Testing infrastructure exists but is not actively maintained or comprehensive. The test suite covers a small subset of the application's functionality.

## Test Runner

**Jest** is configured as the test runner with the following setup:

- **Config file:** `jest.config.cjs`
- **Test match pattern:** `tests/**/*.test.js`
- **Transform:** Babel (via `babel-jest`) for ES module support
- **Global setup:** `jest/globalSetup.js` -- connects to test database, syncs models, truncates data, seeds test fixtures
- **Global teardown:** `jest/globalTeardown.js` -- cleanup after tests
- **Coverage:** HTML reports output to `coverage/`

Run tests:

```bash
npm test
# or
npx jest
```

## Test Files

### Integration Tests

- `tests/app.test.js` -- Main integration test file

### Controller Tests

- `tests/controllers/client/adhyayanBooking.controller.test.js`
- `tests/controllers/client/flatBooking.controller.test.js`
- `tests/controllers/client/mumukshuBooking.controller.test.js`

### Service Tests

- `tests/services/notification.service.test.js`

### Test Factories (Data Generators)

- `tests/cardFactory.js` -- Generates CardDb test records
- `tests/roomFactory.js` -- Generates RoomDb test records
- `tests/shibirFactory.js` -- Generates ShibirDb test records
- `tests/shibirBookingFactory.js` -- Generates ShibirBookingDb test records
- `tests/utsavFactory.js` -- Generates UtsavDb test records

### Test Utilities

- `tests/testConstants.js` -- Test configuration constants
- `tests/helpers/date.helper.js` -- Date utilities for tests

### Ad-hoc Scripts

- `tests/scripts/test_parallel_requests.js` -- Script for testing concurrent request handling

## Test Database

Tests require a separate MySQL database. The test environment is configured via `.env.test`. The global setup (`jest/globalSetup.js`) handles:

1. Database authentication
2. Model synchronization (creates tables)
3. Truncating existing data
4. Seeding test data (cards, rooms, shibirs)

## Coverage

Test coverage is limited. Most controllers, helpers, and the cron job are not covered by tests. The existing tests focus on:

- A few client booking controllers
- The notification service
- Basic integration tests

There are no tests for admin controllers, middleware, payment webhook handling, or the cron job.

## Dev Dependencies for Testing

- `jest` 29.x -- Test runner
- `supertest` 7.x -- HTTP assertion library for integration tests
- `@faker-js/faker` 9.x -- Test data generation
- `@babel/preset-env` + `babel-jest` -- ES module support in Jest
