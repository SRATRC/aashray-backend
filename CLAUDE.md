# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environments

`config/environment.js` loads `.env.${NODE_ENV}` and defaults to `dev` when `NODE_ENV` is unset. There are four wired environments. Two are local, two are deployed.

| `NODE_ENV` | What it is | Database | Run it locally with |
|---|---|---|---|
| `dev` | Local development on your machine. The default. App port 3000. | Local MySQL, database `aashray_test` | `npm run dev` (nodemon) |
| `test` | Automated Jest tests. Jest sets `NODE_ENV=test` itself, so `npm test` needs no flag. | Local MySQL on `127.0.0.1`, database `aashray_test` — **wiped on every run** | `npm test` |
| `qa` | Staging. Render deploys the `dev` branch, and every PR gets its own preview. | Aiven MySQL, TLS required via `DB_CERT`. Base QA and all PR previews share one database. | `NODE_ENV=qa npm run dev` |
| `prod` | Production. Deployed on push to `main`. | MySQL on the app host | `NODE_ENV=prod npm run dev` |

**Every command in the last column runs the code in your working tree.** `NODE_ENV` only selects which `.env.*` file loads. It swaps the database and the credentials, never the logic. So `NODE_ENV=prod npm run dev` runs your local uncommitted code — including a half-finished migration or a debug line — against the production database and the live Razorpay and SES keys. Nothing about that command is remote.

Deployment is a separate thing from this table. Render deploys the `dev` branch to the QA service and each PR to its own preview. `.github/workflows/node.js.yml` deploys `main` to prod on push: it runs pending migrations, then `pm2 reload BackendAPI / CronJob / MCPServer` on a self-hosted runner.

Branches: cut feature branches from `dev` and target PRs at `dev`. Promote to production by merging `dev` into `main`.

Rules that follow from this:

- **`jest/globalSetup.js` truncates `CardDb`, `ShibirDb`, and `RoomDb` in whatever database the loaded env points at**, then re-seeds them. Never run Jest with `NODE_ENV` set to `qa` or `prod`.
- **Every `.env.*` file carries a live `rzp_live_…` Razorpay key and the real SES sender**, including `dev` and `test`. There is no sandbox mode anywhere, so a booking or email flow you exercise locally can still hit live Razorpay or mail a real member.
- Only `qa` uses TLS. `config/database.js` and `config/config.js` both branch on `NODE_ENV === 'qa'` to attach the CA cert from `DB_CERT`.
- **Cron runs in production only.** Prod runs `CronJob` under PM2. QA on Render runs `node app.js` alone, so no scheduled job fires there — but a manual admin or payment action still does.
- A broken migration blocks the whole prod deploy, because the workflow migrates before it reloads PM2. Migrate the other environments by hand with `NODE_ENV=<env> npx sequelize db:migrate` — the same lever as above, so `NODE_ENV=prod` alters the production schema from your machine.
- **Do not pass `--env` to the Sequelize CLI.** There is no `.sequelizerc`, and `config/config.js` loads `.env.${NODE_ENV}` on its own. `--env qa` alone would read your `.env.dev` credentials into the `qa` config block and skip the TLS branch, so you would migrate the local database while believing you targeted QA.
- `config/config.js` is for the Sequelize CLI only. The running app uses `config/database.js`, which holds the pool and retry settings.

## Inspecting live environments

- **Production** — use the `aashray` MCP (read-only): `query_db` / `get_schema` / `get_table_sample` for the prod DB and `get_recent_logs` / `search_logs` / `get_error_logs` for prod logs. See `mcp-server/README.md`.
- **QA / staging / PR previews** (Render, `dev` branch) — use the **Render MCP** and the official `render-*` skills (`render-monitor`, `render-debug`, `render-web-services`) for logs, metrics, and deploy status. Do not read log files off disk: the Render filesystem is ephemeral.
  - Services: QA is `aashray-backend`, a PR preview is `aashray-backend-pr-<N>`. `list_services` needs `includePreviews: true` to return previews.
  - API URLs: `https://aashray-backend.onrender.com` and `https://aashray-backend-pr-<N>.onrender.com`.
  - QA database (Aiven MySQL, read-only runner, needs a local gitignored `.env.qa`):
    ```bash
    node --env-file=.env.qa .claude/skills/aashray-qa-db/qa-db.mjs "SELECT id, name FROM users LIMIT 5"
    ```
  - The `aashray-qa-db` skill holds only what Render tooling does not: the QA credential guardrails and the prod-to-QA snapshot refresh.

Never point QA tooling at prod, or vice versa.

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
NODE_ENV=dev npx sequelize db:migrate
NODE_ENV=dev npx sequelize db:migrate:undo
```

## Environment Setup

Copy `.env.example` to `.env.dev` (or `.env.test`, `.env.qa`, `.env.prod`) — see the Environments table above for what each one targets.

Every `.env.*` file is gitignored, so no environment reads its variables from the repo. `.env.example` is the only tracked one. Prod gets its file written at deploy time from the `PROD_ENV_FILE` GitHub secret. QA gets its variables from the Render service configuration. Ask a teammate for a local `.env.dev`, `.env.test`, or `.env.qa`.

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
