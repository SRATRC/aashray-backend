# Deployment

## Overview

The application is deployed via GitHub Actions to a self-hosted Ubuntu runner. PM2 manages two Node.js processes: the API server and the cron worker.

Code flows through branches as: `feat/*` (or `fix/*`, etc.) -> `dev` -> `main`. The `dev` branch is merged into `main` once per week. Pushing to `main` triggers the deployment pipeline. See [Conventions](../getting-started/conventions.md#git-workflow-and-branching) for the full branching and PR workflow.

## CI/CD Pipeline

**File:** `.github/workflows/node.js.yml`

**Trigger:** Push to `main` branch.

**Steps:**

1. **Fix permissions** -- Corrects file ownership on the runner
2. **Checkout code** -- Pulls latest code from the repository
3. **Setup Node.js** -- Installs Node.js 23.x with npm cache
4. **Install dependencies** -- `npm ci`
5. **Set environment file** -- Writes production env vars from GitHub secrets to `.env.prod`
6. **Run migrations** -- `NODE_ENV=prod npx sequelize db:migrate --debug`
7. **Reload PM2** -- `sudo pm2 reload BackendAPI --update-env` and `sudo pm2 reload CronJob --update-env`
8. **Verify** -- `sudo pm2 list` and `sudo pm2 show` for both processes

## PM2 Processes

Two PM2 processes run in production:

| Process Name | Entry Point | Description |
|-------------|-------------|-------------|
| `BackendAPI` | `app.js` | Express HTTP server |
| `CronJob` | `cron.js` | Scheduled task worker (every 30 min) |

PM2 `reload` is used instead of `restart` to achieve zero-downtime deployments. The `--update-env` flag ensures the new environment file is picked up.

## Environment Configuration

Production environment variables are stored as a GitHub repository secret (`PROD_ENV_FILE`). During deployment, this secret is written to `.env.prod` on the runner.

The application loads environment from `.env.{NODE_ENV}`:
- `NODE_ENV=prod` reads `.env.prod`

## Self-Hosted Runner

The CI/CD pipeline runs on a self-hosted GitHub Actions runner at:
```
/home/ubuntu/actions-runner-api/_work/aashray-backend/aashray-backend
```

The runner is on an Ubuntu server. PM2 runs with `sudo` privileges.

## Health Check

After deployment, the health check endpoint can verify the server is running:

```bash
curl https://your-domain/api/health
```

Returns:
```json
{
  "status": "healthy",
  "database": "connected",
  "environment": "prod",
  "pool": {
    "current": { "size": 5, "available": 3, "using": 2, "waiting": 0 },
    "configured": { "max": 25, "min": 3 }
  }
}
```

## Graceful Shutdown

Both processes handle graceful shutdown:

- **BackendAPI:** Listens for SIGTERM/SIGINT, closes HTTP server, stops connection monitor, closes database connections, waits up to 30 seconds before forced exit
- **CronJob:** Stops scheduling new jobs, waits for in-progress job to complete, then exits

PM2 `reload` sends SIGTERM to the old process after the new one is ready.

## Logs

Application logs are structured JSON written by Winston with daily-rotate-file transports.

### Log Directory

The log directory defaults to `/home/ubuntu/logs` in production. Override with the `LOG_DIR` environment variable. In local development, `app.js` creates a `./logs` directory if the path does not exist.

### Log Files

| File | Contents | Retention | Max Size |
|------|----------|-----------|----------|
| `{LOG_DIR}/application-YYYY-MM-DD.log` | All log levels | 90 days | 20 MB (gzip rotated) |
| `{LOG_DIR}/error-YYYY-MM-DD.log` | `error` level only | 90 days | 20 MB (gzip rotated) |

### Log Level Gating

In production (`NODE_ENV=prod`), the level gate is `info` -- `debug` and `http` entries are suppressed entirely. All other environments gate at `debug`.

### Correlation and Filtering

Every log entry from an HTTP request includes a `correlationId` (and `userId` after auth). To trace a full request through the logs:

```bash
grep '"correlationId":"a3f8c1"' /home/ubuntu/logs/application-*.log
```

### PM2 Logs

PM2 captures stdout/stderr separately from Winston:

```bash
sudo pm2 logs BackendAPI
sudo pm2 logs CronJob
```

### Clean Logs

Application log files (Winston):
```bash
npm run logs:clean
```

PM2 logs:
```bash
sudo pm2 flush
```

## Manual Deployment

If the CI/CD pipeline is unavailable:

```bash
cd /path/to/aashray-backend
git pull origin main
npm ci
NODE_ENV=prod npx sequelize db:migrate
sudo pm2 reload BackendAPI --update-env
sudo pm2 reload CronJob --update-env
```
