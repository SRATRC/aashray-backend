# Environment Configuration

## How It Works

Environment variables are loaded at startup by `config/environment.js`:

```javascript
const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);
config({ path: envFilePath });
```

This means:

- `NODE_ENV=dev` loads `.env.dev`
- `NODE_ENV=test` loads `.env.test`
- `NODE_ENV=qa` loads `.env.qa`
- `NODE_ENV=prod` loads `.env.prod`

If `NODE_ENV` is not set, it defaults to `dev`.

## Environment Files

| File        | Purpose                                          |
| ----------- | ------------------------------------------------ |
| `.env.dev`  | Local development                                |
| `.env.test` | Jest test suite (separate database)              |
| `.env.qa`   | QA/staging environment                           |
| `.env.prod` | Production (created by CI/CD from GitHub secret) |

All `.env.*` files are gitignored.

## Complete Variable Reference

### Application

| Variable         | Required | Dev        | QA                  | Prod                | Description                     |
| ---------------- | -------- | ---------- | ------------------- | ------------------- | ------------------------------- |
| `NODE_ENV`       | Yes      | `dev`      | `qa`                | `prod`              | Environment name                |
| `PORT`           | No       | `3000`     | `3000`              | `3000`              | HTTP listen port                |
| `SESSION_SECRET` | Yes      | any string | any string          | strong random       | Express session secret          |
| `LOG_DIR`        | No       | `./logs`   | `/home/ubuntu/logs` | `/home/ubuntu/logs` | Directory for Winston log files |

### Database

| Variable      | Required | Dev           | QA           | Prod           | Description                          |
| ------------- | -------- | ------------- | ------------ | -------------- | ------------------------------------ |
| `DB_HOST`     | Yes      | `localhost`   | remote host  | remote host    | MySQL hostname                       |
| `DB_PORT`     | Yes      | `3306`        | `3306`       | `3306`         | MySQL port                           |
| `DB_USERNAME` | Yes      | `root`        | db user      | db user        | MySQL username                       |
| `DB_PASSWORD` | Yes      | local pwd     | remote pwd   | remote pwd     | MySQL password                       |
| `DB_NAME`     | Yes      | `aashray_dev` | `aashray_qa` | `aashray_prod` | Database name                        |
| `DB_CERT`     | QA only  | --            | JSON cert    | --             | SSL certificate for QA DB connection |

The QA environment uses SSL for the database connection. `DB_CERT` must be a JSON string containing a `private_key` field with the CA certificate.

### Authentication

| Variable | Required | Description                              |
| -------- | -------- | ---------------------------------------- |
| `SECRET` | Yes      | JWT signing secret for admin auth tokens |

### AWS

| Variable                | Required | Description                           |
| ----------------------- | -------- | ------------------------------------- |
| `AWS_REGION`            | Yes      | AWS region (e.g., `ap-south-1`)       |
| `AWS_ACCESS_KEY_ID`     | Yes      | IAM access key for S3 and SES         |
| `AWS_SECRET_ACCESS_KEY` | Yes      | IAM secret key                        |
| `AWS_S3_BUCKET_NAME`    | Yes      | S3 bucket for profile picture uploads |

### Email (AWS SES)

| Variable            | Required | Description                                                     |
| ------------------- | -------- | --------------------------------------------------------------- |
| `SES_SMTP_HOST`     | Yes      | SES SMTP endpoint (e.g., `email-smtp.ap-south-1.amazonaws.com`) |
| `SES_SMTP_PORT`     | Yes      | SMTP port (typically `587`)                                     |
| `SES_SMTP_USERNAME` | Yes      | SES SMTP username (IAM SMTP credential)                         |
| `SES_SMTP_PASSWORD` | Yes      | SES SMTP password                                               |
| `SES_SMTP_EMAIL`    | Yes      | Verified sender email address                                   |

### Razorpay

| Variable                  | Required | Description                                      |
| ------------------------- | -------- | ------------------------------------------------ |
| `RAZORPAY_KEY_ID`         | Yes      | Razorpay API key ID (use `rzp_test_*` for dev)   |
| `RAZORPAY_KEY_SECRET`     | Yes      | Razorpay API key secret                          |
| `RAZORPAY_WEBHOOK_SECRET` | Yes      | Secret for verifying Razorpay webhook signatures |

## Environment-Specific Behaviors

### Database Connection

- **Dev/Test:** Plain MySQL connection, no SSL
- **QA:** MySQL with SSL enabled (reads CA cert from `DB_CERT` env var)
- **Prod:** Plain MySQL connection (SSL handled at network level)

### Logging

Winston logging behavior differs by environment:

- **Dev/Test/QA:** Log level gate at `debug` -- all levels (`error`, `warn`, `info`, `http`, `debug`) are active
- **Prod:** Log level gate at `info` -- `debug` and `http` entries are suppressed entirely

All environments share:

- Console output with colors (human-readable format)
- Daily rotating file logs as structured JSON (queryable by correlation ID, user, domain)
- `LOG_DIR` defaults to `/home/ubuntu/logs` (override via env var); `app.js` creates `./logs` locally if the path does not exist
- 90-day retention, 20 MB max file size with gzip compression
- Separate error-only log file (`error-YYYY-MM-DD.log`)

> TODO (NEEDS FIX ⚠️): The error handler sends stack traces in HTTP responses regardless of environment. This is a security concern for production.

### Server Startup

- **Test environment:** Skips database connection and server listening (for Jest)
- **All other environments:** Connects to database, syncs models, warms up connection pool, starts HTTP server

## Adding a New Environment Variable

1. Add the variable to all `.env.*` files (dev, test, qa, prod)
2. Access it in code via `process.env.VARIABLE_NAME`
3. If it is needed by Sequelize CLI (migrations), also add it to `config/config.js`
4. If it is used by the cron worker, ensure `config/environment.js` is imported at the top of `cron.js` (it already is)
5. For production, update the `PROD_ENV_FILE` GitHub secret

## Hardcoded Configuration

Some configuration values are hardcoded rather than pulled from environment variables:

- **Prices:** `config/constants.js` contains `AC_ROOM_PRICE` (1100), `NAC_ROOM_PRICE` (700), `BREAKFAST_PRICE` (60), `LUNCH_PRICE` (120), `DINNER_PRICE` (120)
- **Connection pool:** `config/database.js` has pool settings (max: 25, min: 3, idle: 10000ms)
- **Cron schedule:** `cron.js` runs every 30 minutes (`*/30 * * * *`)
- **Payment timeout:** `cron.js` cancels unpaid bookings after 24 hours (`MAX_APP_PAYMENT_DURATION`)
- **CORS:** `app.js` allows all origins (`origin: '*'`)
- **Session cookie:** `app.js` sets maxAge to 86400000ms (24 hours), secure: false
- **Feedback window:** 15 days from event completion, starting at hour 13 (`FEEDBACK_ELIGIBILITY_HOUR`)
- **WiFi limit:** Max 3 temporary WiFi codes per user
- **Rate limiting:** Expo push notifications capped at 600/second
- **Log retention:** 90 days, 20 MB max per file, gzip compression
- **Log directory:** `/home/ubuntu/logs` default (override with `LOG_DIR`)
- **Response body truncation:** 500 characters in logs for error responses
