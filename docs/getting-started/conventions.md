# Conventions

## File Naming

- **Routes:** `{domain}.routes.js` (e.g., `roomBooking.routes.js`, `foodManagement.routes.js`)
- **Controllers:** `{domain}.controller.js` (e.g., `auth.controller.js`, `roomManagement.controller.js`)
- **Models:** `{table_name}.model.js` using snake_case (e.g., `room_booking.model.js`, `shibir_db.model.js`)
- **Helpers:** `{domain}.helper.js` (e.g., `roomBooking.helper.js`, `transactions.helper.js`)
- **Middleware:** PascalCase files (e.g., `AdminAuth.js`, `Error.js`, `Logger.js`) except `validate.js`
- **Migrations:** `YYYYMMDDHHMMSS-description.js` (Sequelize CLI timestamp format)
- **Email templates:** camelCase `.hbs` files (e.g., `unifiedBookingEmail.hbs`)

## Function Naming

- Controller functions use PascalCase for CRUD actions: `FetchAllShibir()`, `CancelBooking()`, `ViewAllBookings()`
- Some controller functions use camelCase: `login()`, `createAdmin()`, `verifyAndLogin()`
- Helper functions use camelCase: `bookFoodForMumukshus()`, `checkRoomAlreadyBooked()`

> TODO (NEEDS FIX): The naming is inconsistent between PascalCase and camelCase for controller functions. There is no enforced convention; both styles coexist.

## Variable and Column Naming

- JavaScript variables: camelCase (`bookingid`, `cardno`, `shibirId`)
- Database columns: snake_case in most models (`shibir_id`, `start_date`, `requested_by`) but some use camelCase (`cardno`, `bookingid`, `roomno`)
- Constants: UPPER_SNAKE_CASE (e.g., `STATUS_WAITING`, `ROLE_SUPER_ADMIN`, `AC_ROOM_PRICE`)

## Code Organization

### Adding a new feature

A new feature typically requires files in these directories:

1. `models/` -- Define the Sequelize model
2. `models/associations.js` -- Add relationships
3. `routes/client/` and/or `routes/admin/` -- Define endpoints
4. `controllers/client/` and/or `controllers/admin/` -- Implement handlers
5. `helpers/` -- Extract reusable business logic
6. `migrations/` -- Schema change migration

### Route structure

Routes are thin. They define HTTP method, path, middleware, and point to a controller function:

```javascript
import { Router } from 'express';
import { validateCard } from '../../middleware/validate.js';
import {
  FetchBookings,
  CancelBooking
} from '../../controllers/client/roomBooking.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = Router();
router.use(validateCard);

router.get('/bookings', CatchAsync(FetchBookings));
router.post('/cancel', CatchAsync(CancelBooking));

export default router;
```

### Controller structure

Controllers handle request parsing and response formatting. Business logic lives in helpers:

```javascript
export const FetchBookings = async (req, res) => {
  const { cardno } = req.body;
  // ... query logic or helper call
  res.status(200).json({ message: 'Fetched successfully', data: results });
};
```

All controller functions are wrapped in `CatchAsync()` at the route level, so they do not need try/catch blocks unless managing transactions manually.

## Error Handling Pattern

Errors are thrown using `ApiError` and caught by the `CatchAsync` wrapper:

```javascript
import ApiError from '../../utils/ApiError.js';

// In a controller or helper:
if (!booking) {
  throw new ApiError(404, 'Booking not found');
}
```

The global `ErrorHandler` middleware catches all errors and returns a consistent JSON response. See [Error Handling](../architecture/error-handling.md) for details.

## Response Format

Successful responses follow this general structure:

```json
{
  "message": "Fetched results successfully",
  "data": { ... }
}
```

For paginated responses:

```json
{
  "message": "Fetched results successfully",
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalCount": 42,
    "totalPages": 5,
    "hasMore": true
  }
}
```

Error responses:

```json
{
  "statusCode": 400,
  "message": "Error description",
  "data": "stack trace or additional error data"
}
```

## Formatting

The project uses Prettier with the following configuration (`.prettierrc.json`):

```json
{
  "trailingComma": "none",
  "tabWidth": 2,
  "semi": true,
  "singleQuote": true
}
```

> TODO (NEEDS FIX ⚠️): There is no ESLint configuration in the project. Code style is enforced only through Prettier.

## Logging Conventions

### Use `req.log`, not the root logger

In controllers, always use `req.log` for logging. It carries the `correlationId` and `userId` automatically. Never import the root `logger` from `config/logger.js` in controller files.

```javascript
// Correct
req.log.info('booking_confirmed', { bookingid, amount });

// Wrong -- loses correlation context
import logger from '../config/logger.js';
logger.info('booking_confirmed', { bookingid, amount });
```

### Pass `req.log` to helpers

Helpers accept an optional `log` parameter (defaulting to the root logger) so they work from both HTTP requests and cron jobs:

```javascript
// Helper signature
export async function myHelper(data, t, log = logger) {
  log.info('helper_started', { data });
}

// Called from controller
await myHelper(data, t, req.log);

// Called from cron (uses root logger automatically)
await myHelper(data, t);
```

### Use snake_case event keys

Log messages use snake_case event keys, not free-form sentences:

```javascript
// Correct
req.log.info('room_booking_confirmed', { bookingid, amount, cardno });

// Wrong
req.log.info('Room booking confirmed successfully');
```

### Log levels

- `info` -- Business events (booking created, payment captured, email sent)
- `debug` -- Internal flow steps (seat decremented, pricing calculated)
- `warn` -- Recoverable problems (validation failed, deprecated endpoint called)
- `error` -- Unrecoverable failures (payment gateway error, database failure)

### Never log sensitive data

- Passwords, tokens, OTPs, PINs are auto-redacted in request body logging
- Never log raw Sequelize model instances or large arrays
- Never log the entire `req` or `res` objects

## Git Workflow and Branching

### Branch Strategy

The repository uses a two-branch model:

- **`main`** -- Production branch. Deployed automatically via CI/CD on push. Never commit directly to main.
- **`dev`** -- Integration branch. All feature work merges here first. Merged into `main` once per week.

### Branch Naming

Always create new branches from `dev`. Use a prefix that describes the type of change:

| Prefix | Use for |
|--------|---------|
| `feat/` | New features or capabilities |
| `fix/` | Bug fixes |
| `chore/` | Maintenance, dependency updates, CI changes |
| `refactor/` | Code restructuring without behavior change |
| `docs/` | Documentation-only changes |

Examples: `feat/wifi-permanent-codes`, `fix/cron-payment-timeout`, `chore/upgrade-sequelize`.

### Pull Request Rules

**One PR = one change.** Each PR should address exactly one feature, fix, or concern. If a PR grows too large to review in one sitting, break it into smaller PRs that can be merged independently.

**Every PR must include:**
1. A clear title following the branch prefix convention (e.g., "feat: add permanent WiFi code management")
2. A description explaining what changed and why
3. Testing instructions so reviewers/maintainers can verify the change locally
4. Documentation updates in the same PR if the change affects API behavior, configuration, or architecture

**PR template outline:**
```markdown
## What
Brief description of the change.

## Why
Context or issue this addresses.

## How to test
Step-by-step instructions for a reviewer to verify the change.

## Checklist
- [ ] Tested locally
- [ ] Docs updated (if applicable)
- [ ] Migration included (if schema changed)
```

### Review and Merge Process

1. Create your branch from `dev`
2. Make your changes, commit with clear messages
3. Push and open a PR targeting `dev`
4. Request review from a senior maintainer
5. Address review feedback
6. Once approved, merge into `dev`
7. `dev` is merged into `main` once per week (triggering production deployment)

### What Not to Do

- Do not push directly to `main` or `dev`
- Do not merge your own PR without review
- Do not bundle unrelated changes into a single PR
- Do not leave PRs open for more than a few days without updating or closing them

## Module System

The project uses ES modules (`"type": "module"` in `package.json`). All imports use `import/export` syntax. The Babel and Jest config files use `.cjs` extension since they require CommonJS format.
