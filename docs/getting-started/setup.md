# Setup

## Prerequisites

- **Node.js** 23.x (the CI/CD pipeline uses 23.x; older LTS versions may work but are untested)
- **MySQL** 8.0+ running locally or accessible remotely
- **npm** (ships with Node.js)
- **AWS account** with S3 bucket and SES configured (for file uploads and email)
- **Razorpay account** (for payment processing)

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/SRATRC/aashray-backend.git
cd aashray-backend
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment

Create a `.env.dev` file in the project root. The app loads `.env.{NODE_ENV}` on startup, defaulting to `NODE_ENV=dev`.

```bash
cp .env.example .env.dev
# Edit .env.dev with your values
```

See the [full environment variable reference](#environment-variables) below.

### 4. Set up the database

Create a MySQL database matching your `DB_NAME` value:

```sql
CREATE DATABASE aashray_dev;
```

The app runs `sequelize.sync()` on startup, which creates tables from model definitions if they do not exist. For an existing database, run pending migrations:

```bash
NODE_ENV=dev npx sequelize db:migrate
```

### 5. Run the server

**Development (with hot reload):**

```bash
npm run dev
```

**Production mode:**

```bash
npm run start:prod
```

**Cron worker (separate process):**

```bash
npm run start:cron
```

### 6. Verify

```bash
curl http://localhost:3000/api
# => {"data":"API is up and running... ","status":200}

curl http://localhost:3000/api/health
# => {"status":"healthy","database":"connected",...}
```

## Environments

| Variable | Description                     |
| -------- | ------------------------------- |
| `dev`    | Local Environment               |
| `qa`     | Deployed Staging Environment    |
| `prod`   | Deployed Production Environment |
| `test`   | Local Test Environment          |

## Environment Variables

All variables are loaded from `.env.{NODE_ENV}` via `dotenv`. The environment file is resolved in `config/environment.js`.

| Variable                  | Required | Description                                                       | Example                               |
| ------------------------- | -------- | ----------------------------------------------------------------- | ------------------------------------- |
| `NODE_ENV`                | Yes      | Environment name. Determines which `.env.*` file loads.           | `dev`, `test`, `qa`, `prod`           |
| `PORT`                    | No       | Server listen port. Defaults to `3000`.                           | `3000`                                |
| `SESSION_SECRET`          | Yes      | Secret for `express-session` cookie signing.                      | `my-session-secret-here`              |
| `DB_HOST`                 | Yes      | MySQL host address.                                               | `localhost`                           |
| `DB_PORT`                 | Yes      | MySQL port.                                                       | `3306`                                |
| `DB_USERNAME`             | Yes      | MySQL user.                                                       | `root`                                |
| `DB_PASSWORD`             | Yes      | MySQL password.                                                   | `********`                            |
| `DB_NAME`                 | Yes      | MySQL database name.                                              | `aashray_dev`                         |
| `DB_CERT`                 | QA only  | JSON string containing SSL certificate for QA database.           | `{"private_key":"-----BEGIN..."}`     |
| `SECRET`                  | Yes      | JWT signing secret for admin authentication.                      | `jwt-secret-key-here`                 |
| `SES_SMTP_HOST`           | Yes      | AWS SES SMTP endpoint.                                            | `email-smtp.ap-south-1.amazonaws.com` |
| `SES_SMTP_PORT`           | Yes      | AWS SES SMTP port.                                                | `587`                                 |
| `SES_SMTP_USERNAME`       | Yes      | AWS SES SMTP username (IAM credential).                           | `AKIA...`                             |
| `SES_SMTP_PASSWORD`       | Yes      | AWS SES SMTP password.                                            | `********`                            |
| `SES_SMTP_EMAIL`          | Yes      | Sender email address for outbound email.                          | `noreply@example.com`                 |
| `RAZORPAY_KEY_ID`         | Yes      | Razorpay API key ID.                                              | `rzp_test_...`                        |
| `RAZORPAY_KEY_SECRET`     | Yes      | Razorpay API key secret.                                          | `********`                            |
| `RAZORPAY_WEBHOOK_SECRET` | Yes      | Secret for verifying Razorpay webhook signatures.                 | `********`                            |
| `AWS_REGION`              | Yes      | AWS region for S3 and other services.                             | `ap-south-1`                          |
| `AWS_ACCESS_KEY_ID`       | Yes      | AWS IAM access key.                                               | `AKIA...`                             |
| `AWS_SECRET_ACCESS_KEY`   | Yes      | AWS IAM secret key.                                               | `********`                            |
| `AWS_S3_BUCKET_NAME`      | Yes      | S3 bucket name for profile picture uploads.                       | `aashray-uploads`                     |
| `LOG_DIR`                 | No       | Directory for Winston log files. Defaults to `/home/ubuntu/logs`. | `./logs`                              |

## Available Scripts

| Script       | Command                     | Description                       |
| ------------ | --------------------------- | --------------------------------- |
| `dev`        | `nodemon app.js`            | Start dev server with auto-reload |
| `start`      | `node app.js`               | Start server                      |
| `start:prod` | `NODE_ENV=prod node app.js` | Start server with production env  |
| `start:cron` | `node cron.js`              | Start cron worker process         |
| `logs:clean` | `rm -rf logs/*`             | Delete all log files              |
| `test`       | `npx jest`                  | Run test suite                    |

## Common Issues

**"SequelizeConnectionRefusedError"**
MySQL is not running or the connection details in `.env.dev` are wrong. Verify MySQL is running and the `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_NAME` values are correct.

**"Cannot find module" errors on startup**
The project uses ES modules (`"type": "module"` in `package.json`). Make sure you are on Node.js 23.x and ran `npm ci` (not `npm install` from a stale lock file).

**Sequelize migration errors**
If `sequelize db:migrate` fails, check that `config/config.js` has the correct database credentials for your environment. The migration CLI reads from this file, not from `config/database.js`.

**Email sending fails silently**
Check that SES SMTP credentials are valid and that the sender email address (`SES_SMTP_EMAIL`) is verified in your SES console. In sandbox mode, recipient addresses also need verification.

**Razorpay webhook not reaching local server**
Use a tunneling tool like ngrok to expose your local server, then configure the tunnel URL as the webhook endpoint in Razorpay dashboard.
